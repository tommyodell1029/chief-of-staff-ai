// POST /api/approvals/:id {approved: boolean, note?} — Tommy's yes or no.
import { decideApproval } from "@/lib/crews/crews";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { approved, note } = (await req.json().catch(() => ({}))) as { approved?: boolean; note?: string };
  if (typeof approved !== "boolean") return Response.json({ error: "approved must be true or false" }, { status: 400 });
  const a = await decideApproval(Number((await params).id), approved, note?.slice(0, 500));
  if (!a) return Response.json({ error: "Not found or already decided" }, { status: 404 });
  return Response.json({ approval: a });
}
