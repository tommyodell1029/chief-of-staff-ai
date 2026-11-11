// GET /api/businesses — tiles for every business. POST /api/businesses {action: "setup"} — create the 3 planned ones.
import { setUpStarterBusinesses } from "@/lib/crews/crews";
import { tilesWithStripe } from "@/lib/tiles";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ businesses: await tilesWithStripe(), fuNumber: Number(getSetting("fu_number") ?? 0) || null });
}

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "setup") return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json({ created: setUpStarterBusinesses() });
}
