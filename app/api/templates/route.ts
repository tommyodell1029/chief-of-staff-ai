// The Crew Template Pack. GET → the uploaded pack (or null). POST {action:"import", pack} | {action:"use", id, name, area?, offer?}
import { applyTemplate, importPack, templatePack } from "@/lib/kit/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ pack: templatePack() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; pack?: unknown; id?: string; name?: string; area?: string; offer?: string };
  try {
    if (b.action === "import") {
      const p = importPack(b.pack);
      return Response.json({ ok: true, message: `${p.title} added: ${p.templates.length} templates ready to use.` });
    }
    if (b.action === "use" && b.id) return Response.json({ ok: true, message: applyTemplate(b.id, { name: b.name ?? "", area: b.area, offer: b.offer }) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
