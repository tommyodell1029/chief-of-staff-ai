// GET /api/announcements?after=<id> — what the station should say (newer than the last one it has),
// plus whether it's quiet hours (show, don't speak). Without "after", returns just the latest id to start from.
import { announcementsAfter, lastAnnouncementId, markStationAwake, quietNow } from "@/lib/announce";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const after = new URL(req.url).searchParams.get("after");
  if (after === null) return Response.json({ lastId: lastAnnouncementId(), items: [], quiet: quietNow() });
  return Response.json({ items: announcementsAfter(Number(after) || 0), quiet: quietNow() });
}

// POST /api/announcements {awake: true} — Tommy just talked to the station (ends weekend "until-awake" quiet for today).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { awake?: boolean };
  if (b.awake) markStationAwake();
  return Response.json({ quiet: quietNow() });
}
