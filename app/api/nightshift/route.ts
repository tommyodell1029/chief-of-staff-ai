// GET /api/nightshift — on/off, budget, what's queued for tonight and the last morning report.
// POST /api/nightshift {on?, budget?} | {action: "add", agentId, instructions} | {action: "remove", taskId}
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { nightStatus, queueForNight, setNightShift } from "@/lib/nightshift";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(nightStatus());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { on?: boolean; budget?: number; action?: string; agentId?: number; instructions?: string; taskId?: number };
  if (b.action === "add" && b.agentId && b.instructions?.trim()) queueForNight(b.agentId, b.instructions.trim());
  else if (b.action === "remove" && b.taskId) getDb().delete(schema.tasks).where(and(eq(schema.tasks.id, b.taskId), eq(schema.tasks.status, "night"))).run();
  else setNightShift({ on: typeof b.on === "boolean" ? b.on : undefined, budget: typeof b.budget === "number" ? b.budget : undefined });
  return Response.json(nightStatus());
}
