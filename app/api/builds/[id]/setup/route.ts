// GET /api/builds/:id/setup — the client's setup file, to import on their assistant's first-run setup screen.
import { getBuild } from "@/lib/builds/builds";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = getBuild(Number((await params).id));
  if (!b?.plan) return new Response("No setup file yet: add the call notes first.", { status: 404 });
  const name = `setup-${b.client.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  return new Response(JSON.stringify(JSON.parse(b.plan), null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
