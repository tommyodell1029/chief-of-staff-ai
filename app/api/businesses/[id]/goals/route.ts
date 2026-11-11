// GET — a business's goals with scorecard lines, the latest Monday review, and the metrics it can use.
// POST {action}: approve | drop | update {target, deadline} | create {title, metric, target, deadline} | record {metric, value}
import { getBusiness } from "@/lib/crews/crews";
import { activateGoal, createGoal, kindOf, METRICS, proposeStarterGoals, recordValue, scorecard, updateGoal } from "@/lib/goals/goals";
import { latestReview } from "@/lib/goals/review";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const b = getBusiness(id);
  if (!b) return Response.json({ error: "Not found" }, { status: 404 });
  proposeStarterGoals(); // once per business; covers businesses set up after Jarvis started
  const kind = kindOf(b);
  return Response.json({
    lines: scorecard(id),
    review: latestReview(id) ?? null,
    metrics: Object.entries(METRICS)
      .filter(([, d]) => d.kinds.includes(kind))
      .map(([key, d]) => ({ key, label: d.label, auto: !!d.collect })),
  });
}

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!getBusiness(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const goalId = num(b.goalId);
  switch (b.action) {
    case "approve":
      if (!goalId) break;
      return Response.json({ goal: activateGoal(goalId, { ...(num(b.target) !== undefined ? { target: num(b.target) } : {}), ...(date(b.deadline) ? { deadline: date(b.deadline) } : {}) }) });
    case "drop":
      if (!goalId) break;
      return Response.json({ goal: updateGoal(goalId, { status: "dropped" }) });
    case "update":
      if (!goalId) break;
      return Response.json({ goal: updateGoal(goalId, { ...(num(b.target) !== undefined ? { target: num(b.target) } : {}), ...(date(b.deadline) ? { deadline: date(b.deadline) } : {}) }) });
    case "create": {
      const target = num(b.target);
      if (typeof b.title !== "string" || !b.title.trim() || typeof b.metric !== "string" || target === undefined) break;
      return Response.json({ goal: createGoal({ businessId: id, title: b.title.trim(), metric: b.metric, target, deadline: date(b.deadline), active: true }) });
    }
    case "record": {
      const value = num(b.value);
      if (typeof b.metric !== "string" || value === undefined) break;
      recordValue(id, b.metric.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"), value);
      return Response.json({ ok: true });
    }
  }
  return Response.json({ error: "Bad request" }, { status: 400 });
}
