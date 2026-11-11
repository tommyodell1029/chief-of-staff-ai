// GET /api/lab — the shortlist and recent research notes. POST /api/lab {action: "research" | "rank"} — run one now.
import { listNotes, listOpportunities, runDailyResearch, runWeeklyRanking, SCORE_LABELS, RESEARCH_AREAS } from "@/lib/growth/lab";
import { spendToday } from "@/lib/spend";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    opportunities: listOpportunities(),
    notes: listNotes(40).filter((n) => !n.area.startsWith("agent:")),
    scoreLabels: SCORE_LABELS,
    areas: RESEARCH_AREAS.map((a) => a.area),
  });
}

// Runs in the background; results show up on the Lab page (and as a phone notification for rankings).
export async function POST(req: Request) {
  const { action, area } = (await req.json().catch(() => ({}))) as { action?: string; area?: string };
  const spend = spendToday();
  if (spend.overCap || spend.overMonthCap) return Response.json({ error: "Spending cap reached." }, { status: 402 });
  const job = action === "rank" ? runWeeklyRanking() : action === "research" ? runDailyResearch(area) : null;
  if (!job) return Response.json({ error: "Unknown action" }, { status: 400 });
  job.catch((err) => console.error(`[lab] ${action} failed:`, err));
  return Response.json({ started: true });
}
