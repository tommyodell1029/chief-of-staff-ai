// GET /api/push/subscribe — the public key the browser needs. POST — save this device. DELETE — forget it.
import { publicKey, removeSubscription, saveSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ publicKey: publicKey() });
}

export async function POST(req: Request) {
  const { subscription, device } = (await req.json().catch(() => ({}))) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    device?: string;
  };
  const { endpoint, keys } = subscription ?? {};
  if (!endpoint?.startsWith("https://") || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: "Bad subscription" }, { status: 400 });
  }
  saveSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, device?.slice(0, 100));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) removeSubscription(endpoint);
  return Response.json({ ok: true });
}
