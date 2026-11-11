// GET /api/about — the About Tommy profile. PUT /api/about — save a new version.
import { readAbout, writeAbout } from "@/lib/about";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ text: readAbout() });
}

export async function PUT(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (typeof text !== "string") return Response.json({ error: "Missing text" }, { status: 400 });
  writeAbout(text);
  return Response.json({ ok: true });
}
