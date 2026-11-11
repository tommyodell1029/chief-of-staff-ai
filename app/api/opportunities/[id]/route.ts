// POST /api/opportunities/:id {decision: "approve" | "pass"}
import { approveOpportunity, passOpportunity } from "@/lib/growth/lab";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: string };
  if (decision === "pass") passOpportunity(id);
  else if (decision === "approve") {
    if (!approveOpportunity(id)) return Response.json({ error: "Already decided" }, { status: 409 });
  } else return Response.json({ error: "Unknown decision" }, { status: 400 });
  return Response.json({ ok: true });
}
