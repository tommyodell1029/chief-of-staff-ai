// Goals and scorecards. Each business has goals ("10 Etsy orders a week by Jan 31"), measured by metrics that Jarvis
// collects every morning (Etsy, Stripe, outreach, audits, Nina's posts, crew work) or that Tommy tells him
// ("we have 2 clients"). The scorecard shows each goal's current value, progress and pace; the Monday review
// (lib/goals/review.ts) uses it to judge each business and set the crews' week.
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { AGENCY_NAME } from "@/config/business";
import { findAgent, listAgents, listBusinesses } from "@/lib/crews/crews";
import { getDb, schema } from "@/lib/db";
import type { Business, Goal } from "@/lib/db/schema";

const db = () => getDb();
const DAY = 86_400_000;
const kpi = (key: string) => `kpi:${key}`; // stored in the metrics table under this name

export type BizKind = "pod" | "nina" | "agency" | "other";
export function kindOf(b: Pick<Business, "name">): BizKind {
  const n = b.name.toLowerCase();
  if (n.includes(AGENCY_NAME.toLowerCase()) || n.includes("launchpad")) return "agency";
  if (n.includes("nina")) return "nina";
  if (n.includes("etsy") || n.includes("photo") || n.includes("pod")) return "pod";
  return "other";
}

interface MetricDef {
  label: string;
  unit: "" | "$";
  kinds: BizKind[]; // which businesses it belongs to
  collect?: (b: Business) => Promise<number | null>; // automatic; manual metrics have none
}

const weekAgo = () => new Date(Date.now() - 7 * DAY);

async function crewTasksDone(b: Business) {
  const ids = listAgents(b.id).map((a) => a.id);
  if (!ids.length) return 0;
  return db()
    .select()
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.agentId, ids), eq(schema.tasks.status, "done"), gte(schema.tasks.createdAt, weekAgo())))
    .all().length;
}

export const METRICS: Record<string, MetricDef> = {
  etsy_orders_week: {
    label: "Etsy orders (last 7 days)",
    unit: "",
    kinds: ["pod"],
    collect: async () => {
      const { etsyConnected, etsyOrdersSince } = await import("@/lib/integrations/etsy");
      if (!etsyConnected()) return null;
      return (await etsyOrdersSince(Math.floor(weekAgo().getTime() / 1000))).length;
    },
  },
  etsy_sales_week: {
    label: "Etsy sales $ (last 7 days)",
    unit: "$",
    kinds: ["pod"],
    collect: async () => {
      const { etsyConnected, etsyOrdersSince } = await import("@/lib/integrations/etsy");
      if (!etsyConnected()) return null;
      return Math.round((await etsyOrdersSince(Math.floor(weekAgo().getTime() / 1000))).reduce((s, o) => s + o.total, 0));
    },
  },
  etsy_sales_month: {
    label: "Etsy sales $ (this month)",
    unit: "$",
    kinds: ["pod"],
    collect: async () => {
      const { etsyConnected, etsySummary } = await import("@/lib/integrations/etsy");
      return etsyConnected() ? Math.round((await etsySummary()).monthUsd) : null;
    },
  },
  agency_mrr: {
    label: "Monthly recurring revenue $",
    unit: "$",
    kinds: ["agency"],
    collect: async () => {
      const { stripeConfigured, stripeSummary } = await import("@/lib/integrations/stripe");
      return stripeConfigured() ? Math.round((await stripeSummary()).mrrUsd) : null;
    },
  },
  agency_clients: {
    label: "Paying clients",
    unit: "",
    kinds: ["agency"],
    collect: async () => {
      // Stripe subscriptions if Stripe is connected; otherwise Tommy tells Jarvis.
      const { stripeConfigured, stripeSummary } = await import("@/lib/integrations/stripe");
      return stripeConfigured() ? (await stripeSummary()).activeSubscriptions : null;
    },
  },
  audit_requests_week: {
    label: "Free audit requests (last 7 days)",
    unit: "",
    kinds: ["agency"],
    collect: async () => {
      const { agent } = findAgent(AGENCY_NAME, "Audit Desk");
      if (!agent) return 0;
      return db()
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.agentId, agent.id), gte(schema.tasks.createdAt, weekAgo())))
        .all()
        .filter((t) => /audit request|said yes/i.test(t.instructions)).length;
    },
  },
  leads_week: {
    label: "New leads found (last 7 days)",
    unit: "",
    kinds: ["agency"],
    collect: async () => db().select().from(schema.leads).where(gte(schema.leads.createdAt, weekAgo())).all().length,
  },
  interested_week: {
    label: "Interested replies (last 7 days)",
    unit: "",
    kinds: ["agency"],
    collect: async () =>
      db()
        .select()
        .from(schema.leads)
        .where(and(eq(schema.leads.status, "interested"), gte(schema.leads.lastReplyAt, weekAgo())))
        .all().length,
  },
  nina_posts_week: {
    label: "Nina posts approved (last 7 days)",
    unit: "",
    kinds: ["nina"],
    collect: async (b) =>
      db()
        .select()
        .from(schema.contentItems)
        .where(and(eq(schema.contentItems.businessId, b.id), gte(schema.contentItems.createdAt, weekAgo())))
        .all()
        .filter((c) => c.status === "approved" || c.status === "posted").length,
  },
  ig_followers: { label: "Instagram followers", unit: "", kinds: ["nina"] },
  tiktok_followers: { label: "TikTok followers", unit: "", kinds: ["nina"] },
  fanvue_subscribers: { label: "Fanvue subscribers", unit: "", kinds: ["nina"] },
  nina_engagement: { label: "Instagram engagement rate % (last 7 days)", unit: "", kinds: ["nina"] },
  nina_bio_clicks: { label: "Bio link clicks to Etsy (last 7 days)", unit: "", kinds: ["nina"] },
  crew_tasks_week: { label: "Crew tasks finished (last 7 days)", unit: "", kinds: ["pod", "nina", "agency", "other"], collect: crewTasksDone },
};

export const metricLabel = (key: string) => METRICS[key]?.label ?? key.replace(/_/g, " ");
export const metricUnit = (key: string) => METRICS[key]?.unit ?? "";

// ---------- Values ----------

export function recordValue(businessId: number, key: string, value: number) {
  db().insert(schema.metrics).values({ businessId, name: kpi(key), value }).run();
}

export function latestValue(businessId: number, key: string, before?: Date): number | null {
  const conds = [eq(schema.metrics.businessId, businessId), eq(schema.metrics.name, kpi(key))];
  if (before) conds.push(lte(schema.metrics.recordedAt, before));
  return db().select().from(schema.metrics).where(and(...conds)).orderBy(desc(schema.metrics.recordedAt)).limit(1).get()?.value ?? null;
}

// Every morning: snapshot each automatic metric for each business (errors skip that metric, not the run).
export async function collectMetrics() {
  for (const b of listBusinesses()) {
    const kind = kindOf(b);
    for (const [key, def] of Object.entries(METRICS)) {
      if (!def.collect || !def.kinds.includes(kind)) continue;
      try {
        const v = await def.collect(b);
        if (v !== null && Number.isFinite(v)) recordValue(b.id, key, v);
      } catch (err) {
        console.error(`[goals] ${b.name} ${key}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

// ---------- Goals ----------

export function listGoals(businessId?: number, statuses: string[] = ["proposed", "active", "met"]) {
  const conds = [inArray(schema.goals.status, statuses)];
  if (businessId) conds.push(eq(schema.goals.businessId, businessId));
  return db().select().from(schema.goals).where(and(...conds)).orderBy(schema.goals.id).all();
}

export function createGoal(g: { businessId: number; title: string; metric: string; target: number; deadline?: string | null; active?: boolean }): Goal {
  const metric = g.metric.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40);
  const row = db()
    .insert(schema.goals)
    .values({ businessId: g.businessId, title: g.title.slice(0, 120), metric, target: g.target, deadline: g.deadline ?? null, status: "proposed" })
    .returning()
    .get();
  return g.active ? activateGoal(row.id)! : row;
}

// "5 audit requests a week" with a new target of 4 becomes "4 audit requests a week".
function retitle(g: Goal, target?: number): string | undefined {
  if (target === undefined || target === g.target) return undefined;
  const old = g.target.toLocaleString("en-US");
  const fresh = target.toLocaleString("en-US");
  for (const form of [old, String(g.target)]) if (g.title.includes(form)) return g.title.replace(form, fresh);
  return undefined;
}

export function activateGoal(id: number, changes: { target?: number; deadline?: string | null } = {}) {
  const g = db().select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  if (!g) return undefined;
  const title = retitle(g, changes.target);
  return db()
    .update(schema.goals)
    .set({ ...changes, ...(title ? { title } : {}), status: "active", activatedAt: new Date(), startValue: latestValue(g.businessId!, g.metric) ?? 0 })
    .where(eq(schema.goals.id, id))
    .returning()
    .get();
}

export function updateGoal(id: number, changes: { status?: "dropped" | "active" | "met"; target?: number; deadline?: string | null; title?: string }) {
  const g = db().select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  const title = !changes.title && g ? retitle(g, changes.target) : undefined;
  return db().update(schema.goals).set({ ...changes, ...(title ? { title } : {}) }).where(eq(schema.goals.id, id)).returning().get();
}

// Starter goals, proposed once per business so Tommy only has to approve or adjust them.
const STARTERS: Record<BizKind, { title: string; metric: string; target: number; deadline: string }[]> = {
  pod: [
    { title: "10 Etsy orders a week", metric: "etsy_orders_week", target: 10, deadline: "2027-01-31" },
    { title: "$1,000 a month in Etsy sales", metric: "etsy_sales_month", target: 1000, deadline: "2027-02-28" },
  ],
  agency: [
    { title: "3 paying clients", metric: "agency_clients", target: 3, deadline: "2027-02-28" },
    { title: "5 free audit requests a week", metric: "audit_requests_week", target: 5, deadline: "2026-12-31" },
  ],
  nina: [
    { title: "5 Nina posts a week", metric: "nina_posts_week", target: 5, deadline: "2026-12-15" },
    { title: "1,000 Instagram followers", metric: "ig_followers", target: 1000, deadline: "2027-03-31" },
  ],
  other: [],
};

export function proposeStarterGoals() {
  const s = (k: string) => db().select().from(schema.settings).where(eq(schema.settings.key, k)).get();
  for (const b of listBusinesses()) {
    const key = `goals_proposed:${b.id}`;
    if (s(key)) continue;
    db().insert(schema.settings).values({ key, value: "1" }).run();
    if (listGoals(b.id, ["proposed", "active", "met", "dropped"]).length) continue;
    for (const g of STARTERS[kindOf(b)]) createGoal({ businessId: b.id, ...g });
  }
}

// ---------- Scorecard ----------

export interface ScoreLine {
  goal: Goal;
  label: string;
  unit: string;
  current: number | null;
  weekAgo: number | null;
  pct: number; // 0-100 of target
  pace: "met" | "on_track" | "behind" | "no_data" | "not_started";
  daysLeft: number | null;
}

export function scorecard(businessId: number): ScoreLine[] {
  const now = Date.now();
  return listGoals(businessId, ["active", "met", "proposed"]).map((goal) => {
    const current = latestValue(businessId, goal.metric);
    const prior = latestValue(businessId, goal.metric, new Date(now - 7 * DAY));
    const pct = current === null || goal.target <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((current / goal.target) * 100)));
    const deadline = goal.deadline ? Date.parse(`${goal.deadline}T23:59:59`) : null;
    const daysLeft = deadline ? Math.ceil((deadline - now) / DAY) : null;
    let pace: ScoreLine["pace"] = "no_data";
    if (goal.status === "proposed") pace = "not_started";
    else if (goal.status === "met" || (current !== null && current >= goal.target)) pace = "met";
    else if (current !== null) {
      // Straight-line pace from where it started to the target by the deadline.
      const start = goal.startValue ?? 0;
      const began = goal.activatedAt?.getTime() ?? now;
      const frac = deadline && deadline > began ? Math.min(1, (now - began) / (deadline - began)) : 1;
      const expected = start + (goal.target - start) * frac;
      pace = current >= expected ? "on_track" : "behind";
    }
    return { goal, label: metricLabel(goal.metric), unit: metricUnit(goal.metric), current, weekAgo: prior, pct, pace, daysLeft };
  });
}

// Marks goals reached (once), so the review can celebrate and propose the next one.
export function markMetGoals(businessId: number): Goal[] {
  const met: Goal[] = [];
  for (const line of scorecard(businessId)) {
    if (line.goal.status === "active" && line.current !== null && line.current >= line.goal.target) {
      met.push(db().update(schema.goals).set({ status: "met", metAt: new Date() }).where(eq(schema.goals.id, line.goal.id)).returning().get());
    }
  }
  return met;
}

const fmt = (v: number | null, unit: string) => (v === null ? "no data yet" : unit === "$" ? `$${Math.round(v).toLocaleString()}` : String(Math.round(v * 10) / 10));
const PACE: Record<ScoreLine["pace"], string> = { met: "MET", on_track: "on track", behind: "BEHIND", no_data: "no data yet", not_started: "proposed, not approved" };

export function scorecardText(businessId: number): string {
  const lines = scorecard(businessId);
  if (!lines.length) return "(no goals set)";
  return lines
    .map((l) => {
      const trend = l.current !== null && l.weekAgo !== null ? ` (week ago: ${fmt(l.weekAgo, l.unit)})` : "";
      return `- ${l.goal.title}: ${fmt(l.current, l.unit)} of ${fmt(l.goal.target, l.unit)} [${l.label}]${trend} — ${PACE[l.pace]}${l.daysLeft !== null ? `, ${l.daysLeft} days left` : ""}`;
    })
    .join("\n");
}
