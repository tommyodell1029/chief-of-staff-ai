// GET — a business with its crew and tasks. PATCH {status} — approve/pause the crew. POST {metric, value} — log numbers.
import { getBusiness, listAgents, listTasks, setCrewStatus, setMetric } from "@/lib/crews/crews";
import { listNotes } from "@/lib/growth/lab";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const business = getBusiness(id);
  if (!business) return Response.json({ error: "Not found" }, { status: 404 });
  const agents = listAgents(id).map((a) => ({ ...a, notes: listNotes(5, `agent:${a.id}`) }));
  return Response.json({ business, agents, tasks: listTasks({ businessId: id, limit: 40 }) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (status !== "active" && status !== "paused") return Response.json({ error: "Bad status" }, { status: 400 });
  setCrewStatus(id, status);
  return Response.json({ ok: true });
}

export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const { metric, value } = (await req.json().catch(() => ({}))) as { metric?: string; value?: number };
  if ((metric !== "revenue" && metric !== "mrr") || typeof value !== "number" || !Number.isFinite(value)) {
    return Response.json({ error: "Bad metric" }, { status: 400 });
  }
  setMetric(id, metric, value);
  return Response.json({ ok: true });
}
