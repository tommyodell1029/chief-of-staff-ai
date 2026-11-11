// GET /api/memories — all memories. POST /api/memories — add one by hand (saved as confirmed).
import { addMemory, listMemories } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ memories: listMemories() });
}

export async function POST(req: Request) {
  const { fact, category } = (await req.json().catch(() => ({}))) as { fact?: string; category?: string };
  if (!fact?.trim()) return Response.json({ error: "Fact is required" }, { status: 400 });
  return Response.json({ memory: addMemory(fact, category || "general", "manual", true) });
}
