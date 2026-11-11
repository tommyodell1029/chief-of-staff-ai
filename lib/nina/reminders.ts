// Posting reminders. Nina's posts go out by hand (Share… from Nina Studio), so every approved post gets a posting
// time, and at that time Tommy's phone (and the station) says "time to post": one tap opens the post ready to share.
// Times fit his day: weekdays at lunch and in the evening, weekends late morning and early evening, one post per slot.
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ContentItem } from "@/lib/db/schema";

const tz = () => process.env.TZ || "America/New_York";
const WEEKDAY_SLOTS: [number, number][] = [
  [12, 15],
  [19, 0],
];
const WEEKEND_SLOTS: [number, number][] = [
  [11, 0],
  [18, 30],
];

// Minutes the time zone is ahead of UTC at a moment (e.g. -300 for New York in winter).
function offsetMinutes(at: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - at) / 60_000);
}

// A wall-clock time in the time zone → the real moment.
export function zonedTime(y: number, m: number, d: number, h: number, min: number, zone = tz()): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetMinutes(guess, zone) * 60_000;
  return guess - offsetMinutes(first, zone) * 60_000; // second pass handles daylight-saving edges
}

function localDate(at: number, zone = tz()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, weekend: p.weekday === "Sat" || p.weekday === "Sun" };
}

// Posting slots from a moment onward, in order.
export function* slotsFrom(from: number, zone = tz()): Generator<number> {
  for (let day = 0; day < 30; day++) {
    const ld = localDate(from + day * 86_400_000, zone);
    for (const [h, min] of ld.weekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS) {
      const t = zonedTime(ld.y, ld.m, ld.d, h, min, zone);
      if (t > from) yield t;
    }
  }
}

function waitingPosts(): ContentItem[] {
  return getDb().select().from(schema.contentItems).where(eq(schema.contentItems.status, "approved")).all();
}

// The next slot (at least 10 minutes away) that no other waiting post has.
export function nextFreeSlot(after = Date.now(), excludeId?: number): Date {
  const taken = new Set(
    waitingPosts()
      .filter((p) => p.id !== excludeId && p.postAt)
      .map((p) => p.postAt!.getTime()),
  );
  for (const t of slotsFrom(after + 10 * 60_000)) if (!taken.has(t)) return new Date(t);
  return new Date(after + 86_400_000);
}

// Called when a post is approved and still has to be posted by hand.
export function schedulePost(id: number): ContentItem | undefined {
  const item = getDb().select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).get();
  if (!item || item.status !== "approved" || item.postAt) return item;
  return getDb().update(schema.contentItems).set({ postAt: nextFreeSlot(Date.now(), id), remindedAt: null }).where(eq(schema.contentItems.id, id)).returning().get();
}

// "Later": the next free slot after this one.
export function snoozePost(id: number): ContentItem | undefined {
  const item = getDb().select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).get();
  if (!item) return undefined;
  const after = Math.max(Date.now(), item.postAt?.getTime() ?? 0);
  return getDb().update(schema.contentItems).set({ postAt: nextFreeSlot(after, id), remindedAt: null }).where(eq(schema.contentItems.id, id)).returning().get();
}

export function whenText(d: Date, zone = tz()): string {
  return d.toLocaleString("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit" });
}

// Every few minutes: posts whose time has come get one reminder.
export async function postingReminders(now = Date.now()) {
  // Posts approved before reminders existed get a time too.
  for (const p of waitingPosts()) if (!p.postAt) schedulePost(p.id);
  const due = getDb()
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "approved"), lte(schema.contentItems.postAt, new Date(now)), isNull(schema.contentItems.remindedAt)))
    .orderBy(asc(schema.contentItems.postAt))
    .all();
  if (!due.length) return;
  const { notifyAll } = await import("@/lib/push");
  for (const p of due) {
    getDb().update(schema.contentItems).set({ remindedAt: new Date(now) }).where(eq(schema.contentItems.id, p.id)).run();
    const platforms = (JSON.parse(p.platforms) as string[]).map((x) => (x === "tiktok" ? "TikTok" : x[0].toUpperCase() + x.slice(1))).join(" + ");
    const what = p.videoFile ? "reel" : "post";
    await notifyAll({
      title: `Time to post Nina's ${what}`,
      body: `${platforms}: ${p.caption.split("\n")[0].slice(0, 90)}. Tap to open it ready to share.`,
      url: `/studio?post=${p.id}`,
      tag: `post-${p.id}`,
      say: `Sir, it's time to post Nina's ${what} on ${platforms}.`,
    }).catch(() => {});
  }
}
