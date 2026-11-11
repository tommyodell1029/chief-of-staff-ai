// Jarvis's public https address, e.g. https://jarvis-ab12.onrender.com.
// Render sets RENDER_EXTERNAL_URL automatically; PUBLIC_URL overrides it (e.g. a custom domain).
// Only as a last resort is it worked out from the request, which can be wrong behind a proxy.
export function publicBaseUrl(req?: Request): string {
  const configured = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (!req) return "http://localhost:3000";
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
