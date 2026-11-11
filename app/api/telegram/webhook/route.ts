// POST /api/telegram/webhook — Telegram delivers messages and button taps here. No sign-in (Telegram can't), so
// every call must carry the secret header Jarvis gave Telegram when connecting; anything else is refused.
import { timingSafeEqual } from "node:crypto";
import { handleTelegramUpdate, telegramConfigured, webhookSecret } from "@/lib/integrations/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!telegramConfigured()) return new Response("Not found", { status: 404 });
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(webhookSecret());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Forbidden", { status: 403 });
  const update = await req.json().catch(() => null);
  // Answer Telegram right away; Jarvis's reply is sent as a separate message when it's ready.
  if (update) handleTelegramUpdate(update).catch((err) => console.error("[telegram] update failed:", err));
  return Response.json({ ok: true });
}
