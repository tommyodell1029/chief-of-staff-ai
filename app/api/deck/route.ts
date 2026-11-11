// GET /api/deck — the Command Deck: every crew and agent with its live state, recent handoffs and open questions.
// POST /api/deck {action: "routes", agentId, to: number[]} | {action: "answer", questionId, answer}
//               | {action: "drop", questionId} | {action: "task", agentId, instructions}
import { eq } from "drizzle-orm";
import { createTask } from "@/lib/crews/crews";
import { answerQuestion, deckState, setRoutes } from "@/lib/crews/deck";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(deckState());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; agentId?: number; to?: number[]; questionId?: number; answer?: string; instructions?: string };
  try {
    if (b.action === "routes" && b.agentId && Array.isArray(b.to)) return Response.json({ to: setRoutes(b.agentId, b.to.map(Number)) });
    if (b.action === "answer" && b.questionId && b.answer?.trim()) {
      const q = answerQuestion(b.questionId, b.answer);
      return q ? Response.json({ question: q }) : Response.json({ error: "That question was already answered." }, { status: 409 });
    }
    if (b.action === "drop" && b.questionId) {
      const db = getDb();
      const q = db.update(schema.questions).set({ status: "dropped", answeredAt: new Date() }).where(eq(schema.questions.id, b.questionId)).returning().get();
      if (q?.taskId) db.update(schema.tasks).set({ status: "done", finishedAt: new Date() }).where(eq(schema.tasks.id, q.taskId)).run();
      return Response.json({ ok: true });
    }
    if (b.action === "task" && b.agentId && b.instructions?.trim()) return Response.json({ task: createTask(b.agentId, b.instructions.trim(), "tommy") });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
