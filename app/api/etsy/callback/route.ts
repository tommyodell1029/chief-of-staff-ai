// GET /api/etsy/callback — Etsy sends Tommy back here after he allows access.
import { etsyRedirectUri, finishEtsyConnect } from "@/lib/integrations/etsy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const [state, verifier] = (req.headers.get("cookie")?.match(/(?:^|;\s*)etsy_pkce=([^;]+)/)?.[1] ?? "").split(".");
  const back = (msg: string) => {
    const headers = new Headers({ Location: `/connections?etsy=${encodeURIComponent(msg)}` });
    headers.append("Set-Cookie", "etsy_pkce=; Path=/api/etsy; Max-Age=0");
    return new Response(null, { status: 302, headers });
  };
  if (url.searchParams.get("error")) return back(`Etsy said: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`);
  if (!state || !verifier || state !== url.searchParams.get("state")) return back("Sign-in expired. Try again.");
  try {
    return back(`connected:${await finishEtsyConnect(url.searchParams.get("code") ?? "", verifier, etsyRedirectUri(req))}`);
  } catch (err) {
    return back(err instanceof Error ? err.message : "Couldn't connect.");
  }
}
