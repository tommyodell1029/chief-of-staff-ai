// POST /api/saleshandy/webhook — Saleshandy tells Jarvis about replies, bounces, unsubscribes and mailbox problems.
// Not behind the sign-in (Saleshandy can't sign in); instead every delivery must carry the secret header Jarvis
// gave Saleshandy when it connected the webhook.
import { timingSafeEqual } from "node:crypto";
import { handleSaleshandyEvent } from "@/lib/outreach/saleshandyReplies";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  const secret = getSetting("saleshandy_webhook_secret");
  const given = req.headers.get("x-jarvis-token") ?? "";
  if (!secret || !same(given, secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return Response.json({ ok: true });
  const event = String(payload.event ?? payload.webhookEvent ?? payload.type ?? payload.eventType ?? "")
    .toLowerCase()
    .replace(/_/g, "-");
  // Answer Saleshandy right away; sorting and drafting a reply can take a minute.
  setImmediate(() => handleSaleshandyEvent(event, payload).catch((err) => console.error("[saleshandy webhook]", err)));
  return Response.json({ ok: true });
}
