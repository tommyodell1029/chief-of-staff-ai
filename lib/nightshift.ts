// Night Shift: work Tommy queues "for tonight" runs while he sleeps (11 pm–6 am), one task at a time, until the
// night's dollar budget is used. Nothing goes out: anything that sends, spends or posts still waits for his OK, and
// the alerts that would wake him (finished tasks, questions, approvals) are held for the morning report instead.
import { and, asc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { spentSince } from "@/lib/spend";

const START_HOUR = 23;
const END_HOUR = 6;
const tz = () => process.env.TZ || "America/New_York";

export function nightShiftOn(): boolean {
  return getSetting("nightshift_on") !== "0"; // on unless Tommy turned it off
}
export function nightBudget(): number {
  const n = Number(getSetting("nightshift_budget") ?? 2);
  return Number.isFinite(n) && n > 0 ? n : 2;
}
export function setNightShift(o: { on?: boolean; budget?: number }) {
  if (o.on !== undefined) setSetting("nightshift_on", o.on ? "1" : "0");
  if (o.budget !== undefined && Number.isFinite(o.budget) && o.budget > 0) setSetting("nightshift_budget", String(Math.min(50, Math.round(o.budget * 100) / 100)));
}

function localHour(now = Date.now()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "numeric", hourCycle: "h23" }).format(new Date(now))) % 24;
}
export function inNightWindow(now = Date.now()): boolean {
  const h = localHour(now);
  return h >= START_HOUR || h < END_HOUR;
}

// Is a shift running right now (started tonight and not yet reported)?
export function nightShiftActive(): boolean {
  return !!getSetting("nightshift_started");
}

function shiftStart(): Date | null {
  const s = Number(getSetting("nightshift_started") ?? 0);
  return s ? new Date(s) : null;
}

// Over tonight's budget? (Checked before each task; the queue stops there.)
export function nightBudgetLeft(): number {
  const start = shiftStart();
  if (!start) return nightBudget();
  return Math.max(0, nightBudget() - spentSince(start).total);
}

// Queue a task for tonight.
export function queueForNight(agentId: number, instructions: string, requestedBy: "tommy" | "jarvis" = "tommy") {
  return getDb().insert(schema.tasks).values({ agentId, instructions, requestedBy, status: "night", createdAt: new Date() }).returning().get();
}

export function nightQueue() {
  return getDb()
    .select({ task: schema.tasks, agent: schema.agents })
    .from(schema.tasks)
    .innerJoin(schema.agents, eq(schema.tasks.agentId, schema.agents.id))
    .where(eq(schema.tasks.status, "night"))
    .orderBy(asc(schema.tasks.createdAt))
    .all();
}

// Alerts that would wake Tommy are held during a shift (the morning report covers them).
export function holdForMorning(tag?: string): boolean {
  return nightShiftActive() && !!tag && /^(task-|question-|approval-)/.test(tag);
}

// Every 5 minutes.
export async function nightShiftTick(now = Date.now()) {
  const db = getDb();
  if (inNightWindow(now)) {
    if (!nightShiftOn()) return;
    if (!nightShiftActive()) {
      if (!nightQueue().length) return; // nothing queued: no shift tonight
      setSetting("nightshift_started", String(Math.floor(now / 1000) * 1000)); // the spend log keeps whole seconds
    }
    if (nightBudgetLeft() <= 0) return;
    const busy = db.select().from(schema.tasks).where(eq(schema.tasks.status, "running")).get() ?? db.select().from(schema.tasks).where(eq(schema.tasks.status, "queued")).get();
    if (busy) return; // one at a time
    const next = nightQueue().find((r) => r.agent.status === "active");
    if (!next) return;
    db.update(schema.tasks).set({ status: "queued", requestedBy: "night" }).where(eq(schema.tasks.id, next.task.id)).run();
    const { processQueue } = await import("@/lib/crews/crews");
    processQueue().catch(() => {});
    return;
  }
  // Morning: the shift ends and Tommy gets the report.
  if (nightShiftActive()) await morningReport(now);
}

export async function morningReport(now = Date.now()) {
  const start = shiftStart();
  setSetting("nightshift_started", "");
  if (!start) return;
  const db = getDb();
  const done = db
    .select({ task: schema.tasks, agent: schema.agents })
    .from(schema.tasks)
    .leftJoin(schema.agents, eq(schema.tasks.agentId, schema.agents.id))
    .where(and(eq(schema.tasks.status, "done"), gte(schema.tasks.finishedAt, start)))
    .all();
  const questions = db.select().from(schema.questions).where(and(eq(schema.questions.status, "open"), gte(schema.questions.createdAt, start))).all().length;
  const approvals = db.select().from(schema.approvals).where(and(eq(schema.approvals.status, "pending"), gte(schema.approvals.createdAt, start))).all().length;
  const left = nightQueue().length;
  const cost = spentSince(start).total;
  const lines = done.map((r) => `• ${r.agent?.name ?? "Agent"}: ${(r.task.review ?? r.task.result ?? "").split("\n")[0].slice(0, 160)}`);
  const text = [
    `Night Shift: ${done.length} task${done.length === 1 ? "" : "s"} done, $${cost.toFixed(2)} of $${nightBudget().toFixed(2)}.`,
    ...lines,
    questions ? `${questions} question${questions === 1 ? "" : "s"} waiting for you.` : "",
    approvals ? `${approvals} approval${approvals === 1 ? "" : "s"} waiting for you.` : "",
    left ? `${left} task${left === 1 ? "" : "s"} left for tonight.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  setSetting("nightshift_last_report", JSON.stringify({ at: now, text }));
  const { notifyAll } = await import("@/lib/push");
  const say = `Good morning, sir. The night shift finished ${done.length} task${done.length === 1 ? "" : "s"}${questions + approvals ? `, and ${questions + approvals} thing${questions + approvals === 1 ? " is" : "s are"} waiting for you` : ""}.`;
  await notifyAll({ title: "Night Shift report", body: text.slice(0, 230), url: "/outbox", tag: "nightshift-report", kind: "briefing", say }).catch(() => {});
}

export function nightStatus() {
  let last: { at: number; text: string } | null = null;
  try {
    last = JSON.parse(getSetting("nightshift_last_report") || "null");
  } catch {}
  return {
    on: nightShiftOn(),
    budget: nightBudget(),
    active: nightShiftActive(),
    budgetLeft: nightBudgetLeft(),
    queued: nightQueue().map((r) => ({ id: r.task.id, agent: r.agent.name, instructions: r.task.instructions.split("\n")[0].slice(0, 140) })),
    last,
  };
}

export function nightText(): string {
  const s = nightStatus();
  return `Night Shift is ${s.on ? "on" : "off"}, budget $${s.budget.toFixed(2)} a night (11 pm–6 am)${s.active ? `, running now with $${s.budgetLeft.toFixed(2)} left` : ""}. ${s.queued.length ? `Queued for tonight: ${s.queued.map((q) => `${q.agent}: ${q.instructions}`).join("; ")}.` : "Nothing queued for tonight."}${s.last ? `\nLast report: ${s.last.text}` : ""}`;
}
