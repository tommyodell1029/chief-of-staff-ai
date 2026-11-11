// GET /api/google/callback — Google sends Tommy back here after he allows access.
import { finishGoogleConnect, googleRedirectUri as redirectUri } from "@/lib/integrations/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cookieState = req.headers.get("cookie")?.match(/(?:^|;\s*)g_state=([a-f0-9]+)/)?.[1];
  const back = (msg: string) => {
    const headers = new Headers({ Location: `/connections?google=${encodeURIComponent(msg)}` });
    headers.append("Set-Cookie", "g_state=; Path=/api/google; Max-Age=0");
    return new Response(null, { status: 302, headers });
  };
  if (url.searchParams.get("error")) return back(`Google said: ${url.searchParams.get("error")}`);
  if (!cookieState || cookieState !== url.searchParams.get("state")) return back("Sign-in expired. Try again.");
  try {
    const email = await finishGoogleConnect(url.searchParams.get("code") ?? "", redirectUri(req));
    return back(`connected:${email}`);
  } catch (err) {
    return back(err instanceof Error ? err.message : "Couldn't connect.");
  }
}
