// GET /api/google/connect — sends Tommy to Google to let Jarvis use his Gmail.
import { randomBytes } from "node:crypto";
import { googleAppConfigured, googleAuthUrl, googleRedirectUri as redirectUri } from "@/lib/integrations/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!googleAppConfigured()) {
    return new Response("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render first (see docs/connections-setup.md).", { status: 400 });
  }
  const state = randomBytes(16).toString("hex");
  const res = Response.redirect(googleAuthUrl(redirectUri(req), state), 302);
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", `g_state=${state}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 302, headers });
}
