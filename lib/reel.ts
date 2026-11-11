// Reel builder: turns a Nina post into a finished vertical video (1080×1920, H.264/AAC, Instagram and TikTok
// ready): her image over a blurred fill with a slow push-in, her voiceover, and word-by-word style captions.
// Runs ffmpeg on the server (bundled with the app, no outside service, no key).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mediaDir, saveMedia } from "@/lib/media";

const run = promisify(execFile);
const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const W = 1080;
const H = 1920;
const FPS = 30;

async function ffmpegPath(): Promise<string> {
  try {
    const m = (await import("@ffmpeg-installer/ffmpeg")) as unknown as { path: string; default?: { path: string } };
    return m.path ?? m.default?.path ?? "ffmpeg";
  } catch {
    return "ffmpeg";
  }
}

// Length of an audio file in seconds (read from ffmpeg's own report).
export async function audioSeconds(file: string): Promise<number> {
  const ff = await ffmpegPath();
  const out = await run(ff, ["-hide_banner", "-i", file], { maxBuffer: 1 << 20 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const m = String((out as { stderr?: string }).stderr ?? "").match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// Splits spoken text into short caption chunks (about 3-4 words), timed by length across the audio.
export function captionChunks(text: string, seconds: number): { text: string; start: number; end: number }[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const len = cur.join(" ").length;
    if (cur.length >= 4 || len >= 18 || /[.!?,;:]$/.test(w)) {
      chunks.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur.join(" "));
  const weight = (c: string) => c.length + 4; // a little time per chunk even when it's short
  const total = chunks.reduce((s, c) => s + weight(c), 0) || 1;
  let t = 0.15;
  const usable = Math.max(1, seconds - 0.3);
  return chunks.map((c) => {
    const d = (weight(c) / total) * usable;
    const out = { text: c, start: t, end: t + d };
    t += d;
    return out;
  });
}

// Wraps a line of text to lines of at most `max` characters.
export function wrap(text: string, max = 20): string {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > max) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

const hookFrom = (caption: string) =>
  caption
    .replace(/^(#?ad\b|ad\s*[:·|-])\s*/i, "")
    .split(/(?<=[.!?])\s|\n|\p{Extended_Pictographic}/u)[0]
    .replace(/[^\p{L}\p{N}\s'’!?.,&-]/gu, "") // emoji don't render in the caption font
    .trim()
    .slice(0, 80);

export interface ReelInput {
  imageFile: string; // in the media folder
  voiceoverFile?: string | null;
  voiceoverText?: string | null;
  caption: string;
}

// Render's Starter plan has 512 MB of memory and Jarvis uses about 140 MB of it, so ffmpeg runs lean: one thread
// (it otherwise starts one per CPU it can see, and the host has many), a modest zoom source, the still decoded once,
// and only one reel at a time. Peak is about 150 MB.
const LEAN = ["-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1"];
let queue: Promise<unknown> = Promise.resolve();

// Builds the reel and returns the new media file name (mp4). Reels are built one at a time.
export function buildReel(p: ReelInput): Promise<string> {
  const job = queue.then(() => buildReelNow(p));
  queue = job.catch(() => {});
  return job;
}

async function buildReelNow(p: ReelInput): Promise<string> {
  const ff = await ffmpegPath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  try {
    const image = path.join(mediaDir(), p.imageFile);
    if (!fs.existsSync(image)) throw new Error("The post's image file is missing.");
    const audio = p.voiceoverFile ? path.join(mediaDir(), p.voiceoverFile) : null;
    const audioLen = audio && fs.existsSync(audio) ? await audioSeconds(audio) : 0;
    const seconds = Math.min(60, audioLen ? audioLen + 0.7 : 8);
    const frames = Math.round(seconds * FPS);

    // 1. A still 9:16 frame: the image fitted over a blurred, darkened copy of itself.
    const still = path.join(dir, "still.png");
    await run(ff, [
      "-y", "-hide_banner", "-loglevel", "error", ...LEAN,
      "-i", image,
      "-filter_complex",
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.12[bg];` +
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`,
      "-frames:v", "1", still,
    ]);

    // 2. Captions: spoken words in chunks (with a voiceover), or the caption's hook line (without).
    // Each line is drawn on its own so every line is centered.
    const texts: { file: string; start: number; end: number; y: string; size: number }[] = [];
    const add = (text: string, start: number, end: number, center: string, size: number) => {
      const lines = text.split("\n");
      const lh = Math.round(size * 1.25);
      lines.forEach((line, i) => {
        const file = path.join(dir, `t${texts.length}.txt`);
        fs.writeFileSync(file, line);
        const offset = Math.round(i * lh - ((lines.length - 1) * lh) / 2);
        texts.push({ file, start, end, y: `${center}${offset >= 0 ? "+" : ""}${offset}`, size });
      });
    };
    if (audioLen && p.voiceoverText?.trim()) {
      for (const c of captionChunks(p.voiceoverText, audioLen)) add(wrap(c.text, 18), c.start, c.end, "h*0.70", 74);
    } else {
      const hook = hookFrom(p.caption);
      if (hook) add(wrap(hook, 20), 0.3, seconds, "h*0.16", 70);
    }
    // Etsy posts are ads: a small "Ad" tag in the video itself, not only in the caption.
    const isAd = /^(#?ad\b|ad\s*[:·|-])/i.test(p.caption.trim());
    if (isAd) {
      const file = path.join(dir, "ad.txt");
      fs.writeFileSync(file, "Ad");
      texts.push({ file, start: 0, end: seconds, y: "90", size: 46 });
    }
    const draw = texts
      .map(
        (t) =>
          `drawtext=fontfile='${FONT}':textfile='${t.file}':fontcolor=white:fontsize=${t.size}:line_spacing=12:` +
          `borderw=7:bordercolor=black@0.85:x=(w-text_w)/2:y=${t.y}-text_h/2:enable='between(t,${t.start.toFixed(2)},${t.end.toFixed(2)})'`,
      )
      .join(",");

    // 3. Slow push-in on the still (zoompan turns the one still frame into every video frame), captions, audio.
    const out = path.join(dir, "reel.mp4");
    const zoom = `scale=${Math.round(W * 1.25)}:${Math.round(H * 1.25)},zoompan=z='min(1+0.0009*on,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`;
    const vf = [zoom, draw, "format=yuv420p"].filter(Boolean).join(",");
    const args = ["-y", "-hide_banner", "-loglevel", "error", ...LEAN, "-i", still];
    if (audioLen && audio) args.push("-i", audio);
    else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    args.push(
      "-filter_complex", `[0:v]${vf}[v]`,
      "-map", "[v]", "-map", "1:a",
      "-t", seconds.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", String(FPS), "-x264-params", "rc-lookahead=5:ref=1", "-threads", "1",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", out,
    );
    await run(ff, args, { maxBuffer: 1 << 22, timeout: 10 * 60_000 });
    return saveMedia(fs.readFileSync(out), "mp4", "reel");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
