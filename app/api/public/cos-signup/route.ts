// POST /api/public/cos-signup — the Chief of Staff AI sales page sends sign-ups here.
// Public on purpose, so it only accepts: requests from the sales page's own address (COS_SITE_ORIGINS, comma-separated),
// an empty hidden "website" field (bots fill every field), at most 5 per visitor per hour, and sensible lengths.
// It never sends anything to the visitor: it saves the sign-up and tells Tommy.
import { addSignup } from "@/lib/builds/signups";

export const dynamic = "force-dynamic";

const allowed = () => new Set((process.env.COS_SITE_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean));

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
  const headers = cors(req.headers.get("origin"));
  if (!headers["Access-Control-Allow-Origin"]) return Response.json({ error: "Not allowed" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return Response.json({ error: "Too many requests. Try again later." }, { status: 429, headers });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (clean(b.website, 200)) return Response.json({ ok: true }, { headers });
  const name = clean(b.name, 80);
  const email = clean(b.email, 120).toLowerCase();
  const interest = (["kit", "done-for-you", "updates"] as const).find((i) => i === b.interest) ?? "updates";
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Response.json({ error: "Please add your name and a valid email." }, { status: 400, headers });
  try {
    await addSignup({ name, email, interest, idea: clean(b.idea, 500) });
  } catch (err) {
    console.error("[cos-signup]", err);
    return Response.json({ error: "Couldn't save that. Try again in a minute." }, { status: 500, headers });
  }
  return Response.json({ ok: true }, { headers });
}
