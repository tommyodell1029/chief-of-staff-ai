// POST /api/builds/:id
//   {action: "notes", notes}           → Jarvis writes the setup file and checklist from the call notes
//   {action: "plan", plan}             → save an edited setup file (JSON)
//   {action: "toggle", item, done}     → tick a checklist item
//   {action: "warmup", date}           → warm-up start date (YYYY-MM-DD) for the countdown
//   {action: "status", status}
import { buildView, planFromNotes, setPlan, setStatus, setWarmupStart, STATUSES, toggleItem } from "@/lib/builds/builds";
import { parseProfile } from "@/lib/kit/profile";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as { action?: string; notes?: string; plan?: unknown; item?: string; done?: boolean; date?: string; status?: string };
  try {
    if (b.action === "notes" && b.notes?.trim()) return Response.json({ build: buildView(await planFromNotes(id, b.notes.trim())) });
    if (b.action === "plan" && b.plan) return Response.json({ build: buildView(setPlan(id, parseProfile(typeof b.plan === "string" ? JSON.parse(b.plan) : b.plan))) });
    if (b.action === "toggle" && b.item) return Response.json({ build: buildView(toggleItem(id, b.item, !!b.done)) });
    if (b.action === "warmup" && /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "")) return Response.json({ build: buildView(setWarmupStart(id, b.date!)) });
    if (b.action === "status" && (STATUSES as readonly string[]).includes(b.status ?? "")) return Response.json({ build: buildView(setStatus(id, b.status as (typeof STATUSES)[number])) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
