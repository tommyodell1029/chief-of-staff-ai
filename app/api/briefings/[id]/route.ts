// POST /api/briefings/:id — mark a briefing as played or dismissed.
import { markBriefingRead } from "@/lib/briefings";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  markBriefingRead(Number((await params).id));
  return Response.json({ ok: true });
}
