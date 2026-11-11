// PATCH /api/todos/:id — complete, reopen, rename, or change the due date. DELETE /api/todos/:id — remove it.
import { deleteTodo, setTodoDone, updateTodo } from "@/lib/todos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as { done?: boolean; title?: string; dueAt?: string | null };
  let todo = typeof body.done === "boolean" ? setTodoDone(id, body.done) : undefined;
  const changes: { title?: string; dueAt?: Date | null } = {};
  if (typeof body.title === "string" && body.title.trim()) changes.title = body.title.trim();
  if (body.dueAt !== undefined) changes.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  if (Object.keys(changes).length) todo = updateTodo(id, changes);
  if (!todo) return Response.json({ error: "Not found or nothing to change" }, { status: 404 });
  return Response.json({ todo });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteTodo(Number((await params).id));
  return Response.json({ ok: true });
}
