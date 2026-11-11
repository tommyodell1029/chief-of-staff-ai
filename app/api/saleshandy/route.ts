// GET /api/saleshandy — whether Saleshandy is connected, its sequences (for picking where a campaign's leads go),
// credit balance, and today's email reveals. POST {action: "connect_webhook"} — have Saleshandy send replies to Jarvis.
import { randomBytes } from "node:crypto";
import { connectWebhook, listSequences, revealsToday, saleshandyConfigured, saleshandyCredits } from "@/lib/integrations/saleshandy";
import { publicBaseUrl } from "@/lib/publicUrl";
import { getSetting, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!saleshandyConfigured()) return Response.json({ configured: false, sequences: [] });
  try {
    const [sequences, credits] = await Promise.all([listSequences(), saleshandyCredits().catch(() => null)]);
    return Response.json({ configured: true, sequences, credits, revealsToday: revealsToday(), repliesConnected: !!getSetting("saleshandy_webhook_secret") });
  } catch (err) {
    return Response.json({ configured: true, sequences: [], error: err instanceof Error ? err.message : String(err) });
  }
}

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "connect_webhook") return Response.json({ error: "Unknown action" }, { status: 400 });
  if (!saleshandyConfigured()) return Response.json({ error: "Add SALESHANDY_API_KEY first." }, { status: 400 });
  let secret = getSetting("saleshandy_webhook_secret");
  if (!secret) {
    secret = randomBytes(24).toString("hex");
    setSetting("saleshandy_webhook_secret", secret);
  }
  try {
    const result = await connectWebhook(`${publicBaseUrl(req)}/api/saleshandy/webhook`, secret);
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
