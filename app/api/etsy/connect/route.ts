// GET /api/etsy/connect — sends Tommy to Etsy to let Jarvis read his shop.
import { etsyAppConfigured, etsyRedirectUri, startEtsyConnect } from "@/lib/integrations/etsy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!etsyAppConfigured()) return new Response("Add ETSY_API_KEY in Render first (see docs/connections-setup.md).", { status: 400 });
  const { url, verifier, state } = startEtsyConnect(etsyRedirectUri(req));
  const headers = new Headers({ Location: url });
  headers.append("Set-Cookie", `etsy_pkce=${state}.${verifier}; Path=/api/etsy; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 302, headers });
}
