// PATCH /api/agents/:id — edit an agent's job, model, tools or autonomy.
import { CREW_TOOLS, type CrewTool } from "@/config/business";
import { MODELS } from "@/config/models";
import { updateAgent } from "@/lib/crews/crews";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as { job?: string; model?: string; tools?: string[]; autonomy?: string };
  const changes: Parameters<typeof updateAgent>[1] = {};
  if (typeof body.job === "string" && body.job.trim()) changes.job = body.job.trim();
  if (body.model === MODELS.writer.id || body.model === MODELS.worker.id) changes.model = body.model;
  if (Array.isArray(body.tools)) changes.allowedTools = JSON.stringify(body.tools.filter((t): t is CrewTool => CREW_TOOLS.includes(t as CrewTool)));
  if (body.autonomy === "approval_required" || body.autonomy === "standing_rules") changes.autonomyLevel = body.autonomy;
  const agent = updateAgent(id, changes);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ agent });
}
