// POST /api/presence {event: "activity"} — Tommy just talked to the station. Returns the greeting or catch-up to
// say first (or null). GET — current presence (home / away / focus / night).
import { getPresence, stationActivity } from "@/lib/presence";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ presence: getPresence() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { event?: string };
  if (b.event !== "activity") return Response.json({ error: "Unknown event" }, { status: 400 });
  return Response.json({ say: await stationActivity() });
}
