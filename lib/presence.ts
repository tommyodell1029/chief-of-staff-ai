// Presence: whether Tommy is home, out, focusing or asleep, so the station knows when to talk and what he missed.
// - "home": normal (quiet hours still apply).
// - "away" ("I'm heading out"): silent until he next talks to the station.
// - "focus" ("focus mode"): silent for a set time, then "Focus time's over, sir."
// - "night" ("goodnight"): silent until 7 am or until he talks to the station.
// When he talks to the station after being away (or after 3+ quiet hours), Jarvis greets him and catches him up on
// what came in meanwhile; the first time each morning he also gets the weather and his first appointment.
import { and, gt } from "drizzle-orm";
import { announce } from "@/lib/announce";
import { calendarConfigured, eventsBetween } from "@/lib/calendar";
import { listApprovals, listBusinesses, listTasks } from "@/lib/crews/crews";
import { getDb, schema } from "@/lib/db";
import { scorecard } from "@/lib/goals/goals";
import { weatherBrief } from "@/lib/integrations/weather";
import { getSetting, setSetting } from "@/lib/settings";
import { spendToday } from "@/lib/spend";
import { listTodos } from "@/lib/todos";

export type Mode = "home" | "away" | "focus" | "night";
interface Presence {
  mode: Mode;
  since: number;
  until?: number;
}

const tz = () => process.env.TZ || "America/New_York";
const GAP_MS = 3 * 3_600_000; // after this long without talking to the station, say what he missed

export function getPresence(now = Date.now()): Presence {
  let p: Presence = { mode: "home", since: now };
  try {
    p = JSON.parse(getSetting("presence") ?? "") as Presence;
  } catch {}
  // Focus and night end on their own.
  if ((p.mode === "focus" || p.mode === "night") && p.until && now >= p.until) return { mode: "home", since: p.since };
  return p;
}

export function setPresence(mode: Mode, until?: number) {
  const prev = getPresence();
  // Keep the time he first went quiet, so the catch-up covers the whole time away.
  const since = prev.mode === "home" ? Date.now() : prev.since;
  setSetting("presence", JSON.stringify({ mode, since, until } satisfies Presence));
}

export function presenceQuiet(now = Date.now()): boolean {
  return getPresence(now).mode !== "home";
}

const lastSeen = () => Number(getSetting("station_last_seen") ?? 0);
const localDay = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: tz() });
const localHour = (t = Date.now()) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "numeric", hour12: false }).format(new Date(t))) % 24;

function nextSevenAm(): number {
  const now = Date.now();
  for (let h = 1; h <= 30; h++) {
    const t = now + h * 3_600_000;
    if (localHour(t) === 7) return t - (new Date(t).getMinutes() * 60_000 + new Date(t).getSeconds() * 1000);
  }
  return now + 8 * 3_600_000;
}

// ---------- What he missed ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n === 1 ? "one" : n} ${n === 1 ? one : many}`;

function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}

export function whatHappenedSince(since: number): string[] {
  const items = getDb().select().from(schema.announcements).where(and(gt(schema.announcements.createdAt, new Date(since)))).all();
  const parts: string[] = [];
  // Etsy orders.
  let orders = 0;
  let dollars = 0;
  for (const a of items.filter((x) => x.kind === "etsy")) {
    const many = a.text.match(/^(\d+) new Etsy orders, \$([\d.]+)/);
    const one = a.text.match(/^New Etsy order: \$([\d.]+)/);
    if (many) {
      orders += Number(many[1]);
      dollars += Number(many[2]);
    } else if (one) {
      orders += 1;
      dollars += Number(one[1]);
    }
  }
  if (orders) parts.push(`${plural(orders, "new Etsy order")}, about ${Math.round(dollars)} dollars`);
  // Audit requests and outreach replies.
  const audits = items.map((a) => a.text.match(/Audit request: ([^:]+):/)?.[1]).filter(Boolean) as string[];
  if (audits.length) parts.push(audits.length === 1 ? `an audit request from ${audits[0]}` : `${audits.length} audit requests, including ${audits[0]}`);
  const wants = items.map((a) => a.text.match(/🔥 (.+?) wants the audit/)?.[1]).filter(Boolean) as string[];
  if (wants.length) parts.push(wants.length === 1 ? `${wants[0]} said yes to the audit` : `${wants.length} prospects said yes to the audit`);
  const questions = items.map((a) => a.text.match(/^(.+?) asked a question/)?.[1]).filter(Boolean) as string[];
  if (questions.length) parts.push(questions.length === 1 ? `${questions[0]} asked a question` : `${questions.length} prospects asked questions`);
  // Calls.
  const calls = items.filter((a) => /^(✅|👉|📞) /.test(a.text) && !/Calling /.test(a.text));
  if (calls.length) parts.push(`${plural(calls.length, "call")} finished`);
  // Everything else (reminders, problems), up to two by name.
  const known = new Set([...items.filter((x) => x.kind === "etsy"), ...calls].map((x) => x.id));
  const other = items.filter(
    (a) => !known.has(a.id) && a.kind !== "approval" && a.kind !== "briefing" && a.kind !== "weather" && a.kind !== "calendar" && !/Audit request|wants the audit|asked a question/.test(a.text),
  );
  if (other.length === 1) parts.push(other[0].text.replace(/[:.]\s*$/, ""));
  else if (other.length > 1) parts.push(`${other.length} other notes, the latest: ${other[other.length - 1].text.replace(/[:.]\s*$/, "")}`);
  return parts;
}

function waitingLine(): string {
  const n = listApprovals("pending").length;
  return n ? `${n === 1 ? "One thing is" : `${n} things are`} waiting for your OK.` : "";
}

async function firstEventToday(): Promise<string> {
  if (!calendarConfigured()) return "";
  const now = Date.now();
  const hoursLeft = 24 - localHour(now);
  const evs = (await eventsBetween(new Date(now), new Date(now + hoursLeft * 3_600_000))).filter((e) => !e.allDay);
  if (!evs.length) return "Nothing on the calendar today.";
  const e = evs[0];
  const at = e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: e.start.getMinutes() ? "2-digit" : undefined, timeZone: tz() });
  return `First up: ${e.title} at ${at}.`;
}

// Called whenever Tommy talks to the station. Returns what to say first, if anything.
export async function stationActivity(now = Date.now()): Promise<{ say: string; text: string } | null> {
  const p = getPresence(now);
  const seen = lastSeen();
  setSetting("station_last_seen", String(now));
  const wasAway = p.mode !== "home" || (seen > 0 && now - seen >= GAP_MS);
  if (p.mode !== "home") setPresence("home");
  const firstToday = !seen || localDay(seen) !== localDay(now);
  const h = localHour(now);

  if (firstToday && h >= 4 && h < 12) {
    const [weather, first] = await Promise.all([weatherBrief("today"), firstEventToday().catch(() => "")]);
    const overnight = seen ? whatHappenedSince(Math.max(seen, p.mode !== "home" ? p.since : seen)) : [];
    const say = [
      "Good morning, sir.",
      weather ? `It's ${weather}.` : "",
      first,
      overnight.length ? `Overnight: ${listJoin(overnight)}.` : "",
      waitingLine(),
    ]
      .filter(Boolean)
      .join(" ");
    return { say, text: "Good morning" };
  }
  if (!wasAway) return null;
  const parts = whatHappenedSince(p.mode !== "home" ? Math.min(p.since, seen || p.since) : seen);
  const hello = h >= 17 || h < 4 ? "Good evening, sir." : "Welcome back, sir.";
  const say = [hello, parts.length ? `While you were out: ${listJoin(parts)}.` : "All quiet while you were out.", waitingLine()].filter(Boolean).join(" ");
  return { say, text: "Catch-up" };
}

// ---------- Protocols ("I'm heading out", "I'm home", "goodnight", "focus mode", "status report") ----------

function todosDue(before: Date, after?: Date) {
  return listTodos(false, 50).filter((t) => t.dueAt && t.dueAt <= before && (!after || t.dueAt > after));
}

export async function protocol(name: "heading_out" | "home" | "goodnight" | "focus" | "end_focus" | "status_report", minutes = 60): Promise<string> {
  const lines: string[] = [];
  const endOfDay = new Date(Date.now() + 18 * 3_600_000);
  switch (name) {
    case "heading_out": {
      setPresence("away");
      setSetting("station_last_seen", String(Date.now()));
      const w = await weatherBrief("today");
      if (w) lines.push(`Weather: ${w}.`);
      const due = todosDue(endOfDay);
      if (due.length) lines.push(`Due today: ${due.map((t) => t.title).slice(0, 3).join("; ")}.`);
      const waiting = listApprovals("pending");
      if (waiting.length) lines.push(`Waiting for his OK: ${waiting.length} (${waiting.slice(0, 2).map((x) => x.approval.what.split("\n")[0].slice(0, 60)).join("; ")}).`);
      lines.push("The station is now quiet until he's back; he'll get a catch-up then. Wish him a good trip in one short line.");
      break;
    }
    case "home": {
      const p = getPresence();
      const since = p.mode !== "home" ? p.since : lastSeen() || Date.now() - GAP_MS;
      setPresence("home");
      setSetting("station_last_seen", String(Date.now()));
      const parts = whatHappenedSince(since);
      lines.push(parts.length ? `While he was out: ${listJoin(parts)}.` : "Nothing new came in while he was out.");
      const w = waitingLine();
      if (w) lines.push(w);
      const tonight = todosDue(endOfDay);
      if (tonight.length) lines.push(`Still due today: ${tonight.map((t) => t.title).slice(0, 3).join("; ")}.`);
      break;
    }
    case "goodnight": {
      const until = nextSevenAm();
      setPresence("night", until);
      const start = new Date(until - 7 * 3_600_000);
      const end = new Date(until + 17 * 3_600_000);
      if (calendarConfigured()) {
        const evs = (await eventsBetween(start, end).catch(() => [])).filter((e) => !e.allDay);
        lines.push(evs.length ? `Tomorrow's first event: ${evs[0].title} at ${evs[0].start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz() })}.` : "Nothing on the calendar tomorrow.");
      }
      const w = await weatherBrief("tomorrow");
      if (w) lines.push(`Tomorrow's weather: ${w}.`);
      const due = todosDue(end, start);
      if (due.length) lines.push(`Due tomorrow: ${due.map((t) => t.title).slice(0, 3).join("; ")}.`);
      lines.push("The station is quiet until 7 am. Say goodnight in one short line.");
      break;
    }
    case "focus": {
      const mins = Math.min(Math.max(Math.round(minutes), 10), 240);
      setPresence("focus", Date.now() + mins * 60_000);
      setSetting("focus_ending_announced", "");
      lines.push(`Focus mode on for ${mins} minutes: the station stays quiet and he'll get a short heads-up when it ends. Confirm in one short line.`);
      break;
    }
    case "end_focus":
      setPresence("home");
      lines.push("Focus mode is off; announcements are back on.");
      break;
    case "status_report": {
      const s = spendToday();
      lines.push(`AI spend: $${s.totalUsd.toFixed(2)} today, $${s.monthUsd.toFixed(2)} of $${s.monthCapUsd} this month.`);
      for (const b of listBusinesses()) {
        const tasks = listTasks({ businessId: b.id, limit: 60 });
        const today = tasks.filter((t) => Date.now() - t.task.createdAt.getTime() < 86_400_000);
        const running = tasks.filter((t) => t.task.status === "queued" || t.task.status === "running").length;
        const behind = scorecard(b.id).filter((l) => l.pace === "behind").map((l) => l.goal.title);
        lines.push(
          `${b.name} (crew ${b.status}): ${today.filter((t) => t.task.status === "done").length} tasks done today, ${running} running${behind.length ? `; behind on ${behind.join(", ")}` : ""}.`,
        );
      }
      const w = waitingLine();
      if (w) lines.push(w);
      const stuck = getDb().select().from(schema.calls).all().filter((c) => c.status === "failed" && c.endedAt && Date.now() - c.endedAt.getTime() < 86_400_000).length;
      if (stuck) lines.push(`${plural(stuck, "phone call")} failed today.`);
      lines.push("Give it as a crisp status report, most important first, under 80 words when spoken.");
      break;
    }
  }
  return lines.join("\n");
}

// Every minute (scheduler): tell him when focus time ends.
export function presenceTick() {
  setSetting("presence_tick", String(Date.now())); // diagnostics checks the minute clock is still running
  try {
    const raw = JSON.parse(getSetting("presence") ?? "{}") as Presence;
    if (raw.mode === "focus" && raw.until && Date.now() >= raw.until && !getSetting("focus_ending_announced")) {
      setSetting("focus_ending_announced", "1");
      setPresence("home");
      announce({ kind: "alert", text: "Focus time's over", say: "Focus time's over, sir. Anything I can take off your plate?" });
    }
  } catch {}
}
