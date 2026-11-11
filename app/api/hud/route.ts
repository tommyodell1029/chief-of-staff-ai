// GET /api/hud — everything the wall/desk display shows, in one call.
import { calendarConfigured, eventsBetween, describeEvent } from "@/lib/calendar";
import { listApprovals, listTasks } from "@/lib/crews/crews";
import { listOpportunities } from "@/lib/growth/lab";
import { getSetting } from "@/lib/settings";
import { spendToday } from "@/lib/spend";
import { tilesWithStripe } from "@/lib/tiles";
import { listTodos } from "@/lib/todos";
import { scorecard } from "@/lib/goals/goals";

export const dynamic = "force-dynamic";

export async function GET() {
  let events: string[] = [];
  if (calendarConfigured()) {
    const from = new Date();
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    events = await eventsBetween(from, to)
      .then((list) => list.slice(0, 5).map(describeEvent))
      .catch(() => []);
  }
  const tiles = await tilesWithStripe();
  return Response.json({
    todos: listTodos(false, 5),
    events,
    waiting: listApprovals("pending").length,
    shortlist: listOpportunities(["proposed"]).length,
    week: tiles.reduce((s, t) => s + t.moneyThisWeek, 0),
    mrr: tiles.reduce((s, t) => s + (t.mrr ?? 0), 0),
    fuNumber: Number(getSetting("fu_number") ?? 0) || null,
    businesses: tiles,
    goals: tiles.flatMap((b) =>
      scorecard(b.id)
        .filter((l) => l.pace !== "not_started")
        .map((l) => ({ business: b.name, title: l.goal.title, pct: l.pct, pace: l.pace, current: l.current, target: l.goal.target, unit: l.unit })),
    ),
    recent: listTasks({ limit: 4 })
      .filter((r) => r.task.status === "done")
      .map((r) => ({ id: r.task.id, agent: r.agent?.name ?? "", summary: r.task.review ?? "" })),
    spend: spendToday(),
  });
}
