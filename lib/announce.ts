// Announcements: what Jarvis says on the station without being asked. Every phone alert becomes one, plus heads-ups
// (calendar, Etsy orders, rain, new approvals). The station polls these, speaks them outside quiet hours, and shows them.
import { personalize } from "@/lib/kit/kit";
import { desc, gt, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";

export type AnnounceKind = "alert" | "calendar" | "etsy" | "weather" | "approval" | "briefing";

// Turns phone-alert wording into something that sounds right out loud.
function spoken(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s*Tap (to|anywhere)[^.]*\.?/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function announce(a: { kind: AnnounceKind; text: string; say?: string }) {
  a = { ...a, text: personalize(a.text), say: a.say === undefined ? undefined : personalize(a.say) };
  const db = getDb();
  const say = spoken(a.say ?? a.text);
  if (!say) return;
  // Bursts of approvals become one line instead of five.
  if (a.kind === "approval") {
    const recent = db
      .select()
      .from(schema.announcements)
      .where(gt(schema.announcements.createdAt, new Date(Date.now() - 90_000)))
      .all()
      .filter((x) => x.kind === "approval");
    if (recent.length >= 2) return;
  }
  db.insert(schema.announcements).values({ kind: a.kind, text: a.text.slice(0, 500), say: say.slice(0, 4000) }).run();
  // Keep a week.
  db.delete(schema.announcements).where(lt(schema.announcements.createdAt, new Date(Date.now() - 7 * 86_400_000))).run();
}

export function announcementsAfter(id: number) {
  return getDb().select().from(schema.announcements).where(gt(schema.announcements.id, id)).orderBy(schema.announcements.id).limit(20).all();
}

export function lastAnnouncementId(): number {
  return getDb().select().from(schema.announcements).orderBy(desc(schema.announcements.id)).limit(1).get()?.id ?? 0;
}

// Quiet hours: announcements are shown on the station but not spoken. STATION_QUIET is a list of windows separated
// by ";", each "[days] HH:MM-HH:MM" (24-hour clock, Tommy's time zone). Days are optional: "Mon-Fri", "Sat,Sun",
// "Mon". A window that crosses midnight (21:00-07:00) runs into the next morning. The old form "21-7" still works.
// "[days] until-awake": quiet on those days until Tommy first talks to the station that day ("Jarvis…" or a tap).
export const DEFAULT_QUIET = "21:00-07:00; Mon-Fri 07:45-17:15; Sat,Sun until-awake";

const localDate = (date: Date, tz: string) => date.toLocaleDateString("en-CA", { timeZone: tz });

// The station calls this when Tommy talks to it; it ends that day's "until-awake" quiet.
export function markStationAwake(date = new Date(), tz = process.env.TZ || "America/New_York") {
  setSetting(`station_awake:${localDate(date, tz)}`, "1");
}
const awakeOn = (date: Date, tz: string) => !!getSetting(`station_awake:${localDate(date, tz)}`);

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseDays(spec: string): Set<number> | null {
  if (!spec.trim()) return null; // every day
  const out = new Set<number>();
  for (const part of spec.toLowerCase().split(",")) {
    const [a, b] = part.split("-").map((d) => DAYS.indexOf(d.trim().slice(0, 3)));
    if (a < 0) continue;
    if (b === undefined || b < 0) out.add(a);
    else for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
  }
  return out.size ? out : null;
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) ? (h % 24) * 60 + (Number.isFinite(m) ? m : 0) : NaN;
};

export function quietAt(
  date: Date,
  rules = process.env.STATION_QUIET || DEFAULT_QUIET,
  tz = process.env.TZ || "America/New_York",
  awake: (date: Date, tz: string) => boolean = awakeOn,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAYS.indexOf(get("weekday").toLowerCase().slice(0, 3));
  const now = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  for (const raw of rules.split(";")) {
    const rule = raw.trim();
    const until = rule.match(/^([A-Za-z,\s-]*?)\s*until-awake$/i);
    if (until) {
      const days = parseDays(until[1] ?? "");
      if ((!days || days.has(day)) && !awake(date, tz)) return true;
      continue;
    }
    const m = rule.match(/^(?:([A-Za-z,\s-]+?)\s+)?(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$/);
    if (!m) continue;
    const days = parseDays(m[1] ?? "");
    const from = toMin(m[2]);
    const to = toMin(m[3]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;
    if (from < to) {
      if (now >= from && now < to && (!days || days.has(day))) return true;
    } else {
      // Crosses midnight: the evening part belongs to today, the morning part to the day it started (yesterday).
      if (now >= from && (!days || days.has(day))) return true;
      if (now < to && (!days || days.has((day + 6) % 7))) return true;
    }
  }
  return false;
}

// Away ("I'm heading out"), focus mode or goodnight (see lib/presence.ts) also keep the station quiet.
function presenceQuietNow(now = Date.now()): boolean {
  try {
    const p = JSON.parse(getSetting("presence") ?? "{}") as { mode?: string; until?: number };
    if (!p.mode || p.mode === "home") return false;
    return p.mode === "away" || !p.until || now < p.until;
  } catch {
    return false;
  }
}

export const quietNow = () => quietAt(new Date()) || presenceQuietNow();
