"use client";
// Browser-side voice: recording the mic, and speaking Jarvis's replies sentence by sentence.

// ---------- Speaking ----------

// A tiny silent WAV. Playing it during a tap "unlocks" audio on iPad Safari,
// which otherwise blocks sound that starts later without a fresh tap.
function silentWav(): string {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples * 2, true);
  let bin = "";
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

// Turn markdown-ish text into something that sounds right when read aloud.
function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private queue: string[] = [];
  private playing = false;
  private buffer = "";
  onStateChange?: (speaking: boolean) => void;

  private el(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.addEventListener("ended", () => this.next());
      this.audio.addEventListener("error", () => this.next());
    }
    return this.audio;
  }

  /** Call from inside a tap/click handler. */
  unlock() {
    if (this.playing) return;
    const a = this.el();
    a.src = silentWav();
    a.play().catch(() => {});
  }

  /** Feed streamed text; whole sentences are spoken as soon as they're complete. */
  push(delta: string) {
    this.buffer += delta;
    const re = /[^.!?\n]*[.!?\n]+["')\]]*\s+/g;
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = re.exec(this.buffer))) consumed = m.index + m[0].length;
    if (consumed > 0) {
      this.enqueue(this.buffer.slice(0, consumed));
      this.buffer = this.buffer.slice(consumed);
    }
  }

  /** Speak whatever is left once the reply is finished. */
  flush() {
    if (this.buffer.trim()) this.enqueue(this.buffer);
    this.buffer = "";
  }

  stop() {
    this.queue = [];
    this.buffer = "";
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
    }
    this.setPlaying(false);
  }

  private enqueue(text: string) {
    const clean = forSpeech(text);
    if (!clean) return;
    this.queue.push(clean);
    if (!this.playing) this.next();
  }

  private next() {
    const text = this.queue.shift();
    if (!text) return this.setPlaying(false);
    this.setPlaying(true);
    const a = this.el();
    a.src = `/api/tts?text=${encodeURIComponent(text)}`;
    a.play().catch(() => this.next());
  }

  private setPlaying(p: boolean) {
    if (this.playing !== p) {
      this.playing = p;
      this.onStateChange?.(p);
    }
  }
}

// ---------- Recording ----------

export function micSupported(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: false };
  if (!window.isSecureContext) {
    return { ok: false, reason: "The mic needs a secure (https) connection. See README → Using the mic on your iPad." };
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return { ok: false, reason: "This browser can't record audio." };
  }
  return { ok: true };
}

function pickMimeType(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

export class Recorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private stopRequested = false;
  private resolveStop?: (b: Blob | null) => void;

  get active() {
    return !!this.rec || !!this.resolveStop;
  }

  async start(): Promise<void> {
    this.stopRequested = false;
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mimeType = pickMimeType();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => {
      const type = this.rec?.mimeType || mimeType || "audio/webm";
      const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
      this.stream?.getTracks().forEach((t) => t.stop());
      this.rec = null;
      this.stream = null;
      this.resolveStop?.(blob);
      this.resolveStop = undefined;
    };
    this.rec.start();
    // If the button was released while we were still waiting for mic permission, stop right away.
    if (this.stopRequested) this.rec.stop();
  }

  /** Stops recording and returns the audio (or null if nothing was captured). */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.stopRequested = true;
      this.resolveStop = resolve;
      // If start() hasn't finished yet, it stops as soon as it does.
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    });
  }

  /** Throw the recording away (or give up after a failed start). */
  cancel() {
    this.resolveStop?.(null);
    this.resolveStop = undefined;
    this.chunks = [];
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    else this.stream?.getTracks().forEach((t) => t.stop());
  }
}

export function extensionFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}
