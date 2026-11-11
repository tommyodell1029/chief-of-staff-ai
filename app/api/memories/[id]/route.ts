// PATCH /api/memories/:id — edit or confirm. DELETE /api/memories/:id — forget it.
import { deleteMemory, updateMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as { fact?: string; category?: string; confirmed?: boolean };
  const changes: Parameters<typeof updateMemory>[1] = {};
  if (typeof body.fact === "string" && body.fact.trim()) changes.fact = body.fact.trim();
  if (typeof body.category === "string" && body.category.trim()) changes.category = body.category.trim().toLowerCase();
  if (typeof body.confirmed === "boolean") changes.confirmed = body.confirmed;
  if (Object.keys(changes).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });
  const memory = updateMemory(id, changes);
  if (!memory) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ memory });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteMemory(Number((await params).id));
  return Response.json({ ok: true });
}
