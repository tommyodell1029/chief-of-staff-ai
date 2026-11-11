// Files Jarvis makes (images, voiceovers), stored on the data disk.
// Private by default; a signed link makes one file fetchable by Instagram, which must download images itself.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/paths";

export function mediaDir(): string {
  const dir = path.join(dataDir(), "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SAFE = /^[a-z0-9-]+\.(jpg|png|mp3|mp4)$/;

export function saveMedia(buf: Buffer, ext: "jpg" | "png" | "mp3" | "mp4", prefix = "file"): string {
  const name = `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(mediaDir(), name), buf);
  return name;
}

export function readMedia(name: string): Buffer | null {
  if (!SAFE.test(name)) return null;
  try {
    return fs.readFileSync(path.join(mediaDir(), name));
  } catch {
    return null;
  }
}

export const mediaType = (name: string) =>
  name.endsWith(".jpg") ? "image/jpeg" : name.endsWith(".png") ? "image/png" : name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";

function signature(name: string) {
  const secret = process.env.SESSION_SECRET || process.env.JARVIS_PASSWORD || "jarvis-local";
  return createHmac("sha256", secret).update(`media:${name}`).digest("hex").slice(0, 32);
}

export function signedMediaPath(name: string) {
  return `/m/${name}?sig=${signature(name)}`;
}

export function validMediaSignature(name: string, sig: string | null) {
  if (!sig || !SAFE.test(name)) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signature(name));
  return a.length === b.length && timingSafeEqual(a, b);
}
