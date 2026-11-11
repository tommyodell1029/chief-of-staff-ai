// GET /api/media/:name — Jarvis-made images, voiceovers and reels, for Tommy (signed in).
//   ?w=640  a resized JPEG preview of an image (made once, then kept next to the original)
//   Range requests are supported, so videos and audio stream instead of downloading in one piece.
// File names are unique (a new image gets a new name), so browsers may cache them for good.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { mediaDir, mediaType, readMedia } from "@/lib/media";

export const dynamic = "force-dynamic";

const SAFE = /^[a-z0-9-]+\.(jpg|png|mp3|mp4)$/;
const CACHE = "private, max-age=31536000, immutable";

async function preview(name: string, width: number): Promise<string | null> {
  const dir = path.join(mediaDir(), "previews");
  const file = path.join(dir, `${name.replace(/\.\w+$/, "")}-w${width}.jpg`);
  if (fs.existsSync(file)) return file;
  const src = readMedia(name);
  if (!src) return null;
  const sharp = (await import("sharp")).default;
  fs.mkdirSync(dir, { recursive: true });
  await sharp(src).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(file);
  return file;
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = (await params).name;
  if (!SAFE.test(name)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const w = Number(url.searchParams.get("w") ?? 0);

  let file = path.join(mediaDir(), name);
  let type = mediaType(name);
  if (w && /\.(jpg|png)$/.test(name)) {
    const p = await preview(name, Math.min(Math.max(Math.round(w), 64), 1600)).catch(() => null);
    if (p) {
      file = p;
      type = "image/jpeg";
    }
  }
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Cache-Control": CACHE },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes", "Cache-Control": CACHE } });
}
