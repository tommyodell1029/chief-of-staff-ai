// GET /api/trust — each autopilot lane with its streak, mode and today's count, plus recent autopilot actions.
// POST /api/trust {lane, auto} — Tommy switches a lane on or off.
import { LANE_IDS, setLaneAuto, trustOverview, type Lane } from "@/lib/trust";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(trustOverview());
}

export async function POST(req: Request) {
  const { lane, auto } = (await req.json().catch(() => ({}))) as { lane?: string; auto?: boolean };
  if (!lane || !(LANE_IDS as string[]).includes(lane) || typeof auto !== "boolean") return Response.json({ error: "Pick a lane and on/off." }, { status: 400 });
  setLaneAuto(lane as Lane, auto);
  return Response.json(trustOverview());
}
