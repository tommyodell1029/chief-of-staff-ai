// POST /api/etsy/holiday {action: "start", cutoff?} — draft Christmas versions of the live listings (each one waits
// for approval). {action: "undo"} — put the originals back after the holidays.
import { DEFAULT_CUTOFF, startHolidayRefresh, undoHolidayRefresh } from "@/lib/etsy/holiday";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; cutoff?: string };
  try {
    if (b.action === "start") return Response.json({ result: await startHolidayRefresh(b.cutoff?.trim() || DEFAULT_CUTOFF) });
    if (b.action === "undo") return Response.json({ result: await undoHolidayRefresh() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
