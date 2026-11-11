// POST /api/public/audit-request — the yourbusiness.com form sends free audit requests here directly.
// Public on purpose (visitors aren't signed in to Jarvis), so it only accepts:
// - requests from the LaunchPad Local website (CORS: yourbusiness.com, www, or AUDIT_FORM_ORIGINS),
// - with an empty hidden "website" field (bots fill every field),
// - at most 5 per visitor per hour, and sensible field lengths.
// It never sends anything: it starts the Audit Desk, whose draft waits for Tommy's approval.
import { startAuditRequest } from "@/lib/outreach/auditRequests";

export const dynamic = "force-dynamic";

const allowed = () =>
  new Set(["https://yourbusiness.com", "https://www.yourbusiness.com", ...(process.env.AUDIT_FORM_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);

function cors(origin: string | null): Record<string, string> {
  if (!origin || !allowed().has(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}

const hits = new Map<string, number[]>();
function tooMany(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "");

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (!headers["Access-Control-Allow-Origin"]) return Response.json({ error: "Not allowed" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return Response.json({ error: "Too many requests. Try again later." }, { status: 429, headers });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (clean(b.website, 200)) return Response.json({ ok: true }, { headers }); // a bot filled the hidden field: pretend it worked
  const r = {
    business: clean(b.business, 120),
    name: clean(b.name, 80),
    trade: clean(b.trade, 80),
    email: clean(b.email, 120).toLowerCase(),
    link: clean(b.link, 200),
    interest: clean(b.plan, 60),
    from: "",
  };
  r.from = r.email;
  if (r.business.length < 2 || r.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) {
    return Response.json({ error: "Please fill in your business, your name and a valid email." }, { status: 400, headers });
  }
  try {
    await startAuditRequest(r, "website");
  } catch (err) {
    console.error("[audit-request]", err);
    return Response.json({ error: "Couldn't save your request." }, { status: 500, headers });
  }
  return Response.json({ ok: true }, { headers });
}
