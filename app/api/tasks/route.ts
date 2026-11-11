// POST /api/tasks {agentId, instructions} — Tommy hands a task straight to an agent.
import { createTask } from "@/lib/crews/crews";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { agentId, instructions } = (await req.json().catch(() => ({}))) as { agentId?: number; instructions?: string };
  if (!agentId || !instructions?.trim()) return Response.json({ error: "agentId and instructions are required" }, { status: 400 });
  return Response.json({ task: createTask(agentId, instructions.trim(), "tommy") });
}
