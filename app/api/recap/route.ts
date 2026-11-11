// GET /api/recap?since=<ms> — what happened while Tommy was away. PUT {fuNumber} — save his F-U money number.
import { recapSince } from "@/lib/crews/crews";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get("since"));
  if (!Number.isFinite(since) || since <= 0) return Response.json({ error: "since is required" }, { status: 400 });
  return Response.json(recapSince(new Date(since)));
}

export async function PUT(req: Request) {
  const { fuNumber } = (await req.json().catch(() => ({}))) as { fuNumber?: number };
  if (typeof fuNumber !== "number" || fuNumber < 0) return Response.json({ error: "Bad number" }, { status: 400 });
  setSetting("fu_number", String(fuNumber));
  return Response.json({ ok: true });
}
