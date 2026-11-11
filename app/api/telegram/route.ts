// POST /api/telegram {action: "connect" | "disconnect"} — from Connections (signed in).
import { connectTelegram, disconnectTelegram } from "@/lib/integrations/telegram";
import { publicBaseUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (action === "connect") return Response.json(await connectTelegram(publicBaseUrl(req)));
    if (action === "disconnect") {
      await disconnectTelegram();
      return Response.json({ ok: true });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
