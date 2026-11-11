// GET /api/outbox[?kind=file|result|audit|post] — everything finished in the last 30 days, newest first.
import { listOutbox, type OutboxEntry } from "@/lib/outbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") as OutboxEntry["kind"] | null;
  return Response.json({ items: listOutbox(kind && ["file", "result", "audit", "post"].includes(kind) ? kind : undefined) });
}
