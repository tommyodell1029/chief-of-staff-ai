// GET /api/outbox/file/:id[?download=1] — a file an agent saved to the Outbox.
import { readOutboxFile } from "@/lib/outbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const f = readOutboxFile(Number((await params).id));
  if (!f) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(f.body), {
    headers: { "Content-Type": f.type, "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${f.name}"`, "Cache-Control": "private, no-store" },
  });
}
