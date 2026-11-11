// GET /api/todos — open and recently completed to-dos. POST /api/todos — add one.
import { addTodo, listTodos } from "@/lib/todos";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ todos: listTodos(true) });
}

export async function POST(req: Request) {
  const { title, dueAt } = (await req.json().catch(() => ({}))) as { title?: string; dueAt?: string | null };
  if (!title?.trim()) return Response.json({ error: "Title is required" }, { status: 400 });
  const due = dueAt ? new Date(dueAt) : null;
  if (due && Number.isNaN(due.getTime())) return Response.json({ error: "Bad date" }, { status: 400 });
  return Response.json({ todo: addTodo(title, due) });
}
