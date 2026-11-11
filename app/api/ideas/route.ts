// "Can you run this?": GET → researched ideas. POST {action:"vet", idea} | {action:"adopt", id} | {action:"dismiss", id}
import { adoptIdea, dismissIdea, listIdeas, vetIdea } from "@/lib/kit/vetting";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ideas: listIdeas().filter((i) => i.status !== "dismissed") });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; idea?: string; id?: number };
  try {
    if (b.action === "vet") return Response.json({ ok: true, idea: vetIdea(b.idea ?? "") });
    if (b.action === "adopt" && b.id) return Response.json({ ok: true, ...adoptIdea(b.id) });
    if (b.action === "dismiss" && b.id) {
      dismissIdea(b.id);
      return Response.json({ ok: true });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
