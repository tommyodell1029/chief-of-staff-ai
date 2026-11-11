// Nina Studio: posts Jarvis prepares (image + caption + optional voiceover), Tommy approves, Jarvis publishes.
// Instagram posts automatically on approval; TikTok, Reddit and Fanvue get a one-tap share package.
import { publicBaseUrl } from "@/lib/publicUrl";
import { autopilotDone, autopilotFailed, canAutopilot, laneForPost, recordTrust } from "@/lib/trust";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ContentItem } from "@/lib/db/schema";
import { speakToBuffer } from "@/lib/elevenlabs";
import { generateImage, geminiConfigured } from "@/lib/integrations/gemini";
import { instagramConfigured, publishImage, publishReel } from "@/lib/integrations/instagram";
import { readMedia, saveMedia, signedMediaPath } from "@/lib/media";
import { schedulePost } from "@/lib/nina/reminders";
import { buildReel } from "@/lib/reel";
import { notifyAll } from "@/lib/push";
import { getSetting, setSetting } from "@/lib/settings";

export const PLATFORMS = ["instagram", "tiktok", "reddit", "fanvue"] as const;
export type Platform = (typeof PLATFORMS)[number];

// Earlier defaults: a saved persona that is still exactly one of these gets the current default.
const OLD_DEFAULT_PERSONAS = [
  "Creator: a fictional, AI-generated woman in her mid-20s. Warm, confident, playful. Latina, long dark wavy hair with soft face-framing highlights, natural makeup, sun-kissed skin. A book girly who loves going out and any excuse to tan or be in a bikini: bookstores and coffee shops, beach reads, golden-hour tanning, pool and beach days, rooftop brunches, nights out with friends, Florida weekends.",
  "Creator: a fictional, AI-generated woman in her mid-20s. Warm, confident, playful. Latina, long dark wavy hair, brown eyes, natural makeup. Lifestyle content: fitness, travel, fashion, coffee, beach days.",
];
const DEFAULT_PERSONA =
  "Creator: a fictional, AI-generated woman, 25. Gorgeous and glam: Latina, long dark wavy hair with soft face-framing highlights, warm brown eyes, glowing sun-kissed skin, polished natural makeup, a big bright smile. Bubbly, giggly, confident, flirty-fun. A book girly who loves going out and any excuse to tan or be in a bikini: golden-hour selfies, outfits and nights out, beach and pool days, beach reads, coffee shops. Always clearly an adult woman; tasteful, never sexual.";

export function getPersona(): string {
  const saved = getSetting("nina_persona");
  return saved && !OLD_DEFAULT_PERSONAS.includes(saved) ? saved : DEFAULT_PERSONA;
}

export function setPersona(text: string) {
  setSetting("nina_persona", text.slice(0, 2000));
}

export function getRefs(): string[] {
  try {
    return JSON.parse(getSetting("nina_refs") || "[]");
  } catch {
    return [];
  }
}

export function setRefs(names: string[]) {
  setSetting("nina_refs", JSON.stringify(names.slice(0, 3)));
}

// Every image prompt carries the persona and hard SFW rules.
function fullPrompt(scene: string): string {
  return `${getPersona()}

Scene: ${scene}

Photorealistic, natural light, vertical Instagram-style photo. If reference photos are attached, keep her face, hair and features identical to them. She is an adult. Fully clothed and safe for work: no nudity, no sexual content.`;
}

async function makeImage(scene: string): Promise<string> {
  const refs = getRefs()
    .map((name) => ({ name, data: readMedia(name) }))
    .filter((r): r is { name: string; data: Buffer } => !!r.data)
    .map((r) => ({ mimeType: "image/jpeg", data: r.data }));
  const jpeg = await generateImage(fullPrompt(scene), refs);
  return saveMedia(jpeg, "jpg", "nina");
}

// Instagram and TikTok allow at most 5 hashtags per post.
export const HASHTAG_LIMIT = 5;
export function capHashtags(tags: string | null | undefined, platforms: string[]): string | undefined {
  if (tags == null) return undefined;
  const list = tags.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  const unique = list.filter((t, i) => list.findIndex((u) => u.toLowerCase() === t.toLowerCase()) === i);
  const limited = platforms.some((p) => /instagram|tiktok/i.test(p)) ? unique.slice(0, HASHTAG_LIMIT) : unique;
  return limited.join(" ");
}

// What Nina says in a reel when no script was written: the caption, cleaned up for speaking (no "Ad" label,
// hashtags, links or emoji), up to about 15 seconds.
export function scriptFromCaption(caption: string): string {
  const clean = caption
    .replace(/^(ad\s*[:·|-]|#?ad\b)\s*/i, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/\s*\p{Extended_Pictographic}+\s*/gu, ". ") // an emoji usually ends a thought
    .replace(/([.!?])(\s*\.)+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+/, "")
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if (out && (out + s).length > 230) break;
    out += s;
  }
  return out.trim().slice(0, 300);
}

// Her delivery: lower stability and more style make the same voice livelier and bubblier.
const NINA_VOICE_SETTINGS = { stability: 0.3, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true };

// Records Nina's voice (ElevenLabs) for a script.
async function recordVoice(text: string): Promise<string> {
  if (!process.env.NINA_VOICE_ID) throw new Error("Nina's voice isn't set up: add NINA_VOICE_ID in Render (see Connections).");
  return saveMedia(await speakToBuffer(text, process.env.NINA_VOICE_ID, NINA_VOICE_SETTINGS), "mp3", "voice");
}

export interface NewPost {
  platforms: Platform[];
  caption: string;
  hashtags?: string;
  imagePrompt?: string;
  voiceoverText?: string;
  notes?: string;
}

export async function createPost(p: NewPost, businessId?: number, opts: { fromCrew?: boolean } = {}): Promise<ContentItem> {
  const db = getDb();
  let item = db
    .insert(schema.contentItems)
    .values({
      businessId: businessId ?? null,
      platforms: JSON.stringify(p.platforms),
      caption: p.caption,
      hashtags: capHashtags(p.hashtags, p.platforms) || null,
      imagePrompt: p.imagePrompt ?? null,
      voiceoverText: p.voiceoverText ?? null,
      notes: p.notes ?? null,
    })
    .returning()
    .get();
  const errors: string[] = [];
  const changes: Partial<ContentItem> = {};
  if (p.imagePrompt) {
    if (!geminiConfigured()) errors.push("No image yet: add GOOGLE_API_KEY (Connections) to make images.");
    else
      try {
        changes.imageFile = await makeImage(p.imagePrompt);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
  }
  // Every crew post gets Nina's voice: the crew's script, or her caption read aloud.
  const script = p.voiceoverText?.trim() || (opts.fromCrew ? scriptFromCaption(p.caption) : "");
  if (script && process.env.NINA_VOICE_ID) {
    try {
      changes.voiceoverFile = await recordVoice(script);
      if (!p.voiceoverText?.trim()) changes.voiceoverText = script;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  // Save the image and voiceover right away, so nothing that happens next can lose them.
  if (errors.length) changes.error = errors.join(" ");
  if (Object.keys(changes).length) {
    item = db.update(schema.contentItems).set(changes).where(eq(schema.contentItems.id, item.id)).returning().get();
  }
  // A post with a voiceover becomes a finished reel (video + her voice + captions).
  if (item.imageFile && item.voiceoverFile) {
    try {
      const videoFile = await buildReel({ imageFile: item.imageFile, voiceoverFile: item.voiceoverFile, voiceoverText: item.voiceoverText, caption: p.caption });
      item = db.update(schema.contentItems).set({ videoFile }).where(eq(schema.contentItems.id, item.id)).returning().get();
    } catch (err) {
      errors.push(`Reel not built (tap Make reel to try again): ${err instanceof Error ? err.message : String(err)}`);
      item = db.update(schema.contentItems).set({ error: errors.join(" ") }).where(eq(schema.contentItems.id, item.id)).returning().get();
    }
  }
  // Trust ladder: a crew post with a finished image, in a lane Tommy put on autopilot, is approved right away.
  const lane = laneForPost(item.caption);
  if (opts.fromCrew && item.imageFile && !item.error && canAutopilot(lane)) {
    recordTrust(lane, "auto", item.caption.slice(0, 120));
    const done = await approveContent(item.id, publicBaseUrl());
    if (done) item = done;
    if (item.status === "failed") await autopilotFailed(lane, item.caption.slice(0, 80), item.error ?? "posting failed");
    else await autopilotDone(lane, item.caption.slice(0, 80), item.postedUrl ? "Posted to Instagram." : "Share package ready in Nina Studio.");
  }
  return item;
}

// Tommy's decision on a post, for the trust ladder (edited = he changed the caption, hashtags or image idea first).
export function recordPostDecision(id: number, approved: boolean) {
  const item = getContent(id);
  if (!item) return;
  const edited = getSetting(`content_edited:${id}`) === "1";
  recordTrust(laneForPost(item.caption), !approved ? "denied" : edited ? "edited" : "approved", item.caption.slice(0, 120));
}

export function listContent(statuses: string[] = ["draft", "approved", "failed"]): ContentItem[] {
  return getDb()
    .select()
    .from(schema.contentItems)
    .where(inArray(schema.contentItems.status, statuses))
    .orderBy(desc(schema.contentItems.createdAt))
    .limit(100)
    .all();
}

export function getContent(id: number) {
  return getDb().select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).get();
}

export function updateContent(id: number, changes: { caption?: string; hashtags?: string; imagePrompt?: string }) {
  const before = getContent(id);
  if (
    before &&
    ((changes.caption !== undefined && changes.caption !== before.caption) ||
      (changes.hashtags !== undefined && changes.hashtags !== (before.hashtags ?? "")) ||
      (changes.imagePrompt !== undefined && changes.imagePrompt !== before.imagePrompt))
  )
    setSetting(`content_edited:${id}`, "1");
  if (changes.hashtags !== undefined) {
    const item = getContent(id);
    const platforms: string[] = item ? JSON.parse(item.platforms || "[]") : [];
    changes = { ...changes, hashtags: capHashtags(changes.hashtags, platforms) ?? "" };
  }
  return getDb().update(schema.contentItems).set(changes).where(eq(schema.contentItems.id, id)).returning().get();
}

// Builds (or rebuilds) the reel for a post: needs its image; uses the voiceover when there is one.
export async function makeReel(id: number) {
  const item = getContent(id);
  if (!item?.imageFile) throw new Error("This post needs an image before it can become a reel.");
  // No voiceover yet: record Nina reading her script (or her caption) first, so the reel has her voice.
  let { voiceoverFile, voiceoverText } = item;
  if (!voiceoverFile) {
    voiceoverText = voiceoverText?.trim() || scriptFromCaption(item.caption);
    voiceoverFile = await recordVoice(voiceoverText);
    getDb().update(schema.contentItems).set({ voiceoverFile, voiceoverText }).where(eq(schema.contentItems.id, id)).run();
  }
  const videoFile = await buildReel({ imageFile: item.imageFile, voiceoverFile, voiceoverText, caption: item.caption });
  return getDb().update(schema.contentItems).set({ videoFile, error: null }).where(eq(schema.contentItems.id, id)).returning().get();
}

export async function regenerateImage(id: number) {
  const item = getContent(id);
  if (!item?.imagePrompt) throw new Error("This post has no image prompt.");
  const imageFile = await makeImage(item.imagePrompt);
  return getDb().update(schema.contentItems).set({ imageFile, error: null }).where(eq(schema.contentItems.id, id)).returning().get();
}

export function rejectContent(id: number) {
  getDb().update(schema.contentItems).set({ status: "rejected", decidedAt: new Date() }).where(eq(schema.contentItems.id, id)).run();
}

export function markShared(id: number) {
  getDb().update(schema.contentItems).set({ status: "posted", postedAt: new Date() }).where(eq(schema.contentItems.id, id)).run();
}

// Tommy approved: post to Instagram now (if it's one of the platforms and connected); the rest become share packages.
export async function approveContent(id: number, publicBaseUrl: string): Promise<ContentItem | undefined> {
  const db = getDb();
  let item = getContent(id);
  if (!item || (item.status !== "draft" && item.status !== "failed")) return item;
  item = db.update(schema.contentItems).set({ status: "approved", decidedAt: new Date(), error: null }).where(eq(schema.contentItems.id, id)).returning().get();
  const platforms = JSON.parse(item.platforms) as Platform[];
  if (platforms.includes("instagram") && instagramConfigured() && (item.videoFile || item.imageFile)) {
    try {
      const caption = [item.caption, item.hashtags].filter(Boolean).join("\n\n");
      const url = item.videoFile
        ? await publishReel(`${publicBaseUrl}${signedMediaPath(item.videoFile)}`, caption)
        : await publishImage(`${publicBaseUrl}${signedMediaPath(item.imageFile!)}`, caption);
      const onlyInstagram = platforms.length === 1;
      item = db
        .update(schema.contentItems)
        .set({ postedUrl: url, status: onlyInstagram ? "posted" : "approved" })
        .where(eq(schema.contentItems.id, id))
        .returning()
        .get();
      notifyAll({ title: "Posted to Instagram", body: item.caption.slice(0, 120), url: "/studio", tag: `post-${id}` }).catch(() => {});
    } catch (err) {
      item = db
        .update(schema.contentItems)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .where(eq(schema.contentItems.id, id))
        .returning()
        .get();
    }
  }
  // Still to be posted by hand: give it a posting time, and Tommy gets a reminder then.
  if (item.status === "approved") item = schedulePost(id) ?? item;
  return item;
}

// Results Tommy types in after posting (likes, comments, saves), used for boost picks.
export function setResults(id: number, r: { likes?: number; comments?: number; saves?: number }) {
  const n = (v?: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  const changes = { likes: n(r.likes), comments: n(r.comments), saves: n(r.saves) };
  return getDb().update(schema.contentItems).set(changes).where(eq(schema.contentItems.id, id)).returning().get();
}
