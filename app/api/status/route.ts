// GET /api/status — spend, setup status, the next to-dos, and any briefing waiting to be played.
// Never returns keys or calendar addresses.
import { BRIEFING_TITLES, unreadBriefing } from "@/lib/briefings";
import { calendarConfigured } from "@/lib/calendar";
import { providerProblem } from "@/lib/llm/compat";
import { identity, kitMode, kitProfile } from "@/lib/kit/kit";
import { getSetting } from "@/lib/settings";
import { spendToday } from "@/lib/spend";
import { listTodos } from "@/lib/todos";

export const dynamic = "force-dynamic";

export async function GET() {
  const b = unreadBriefing();
  return Response.json({
    spend: spendToday(),
    brain: process.env.JARVIS_FAKE_BRAIN === "1" ? "fake" : providerProblem() ? "missing_key" : "ready",
    identity: identity(),
    kit: kitMode() ? { profile: !!kitProfile(), launched: !!getSetting("kit_launched") } : null,
    voice: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
    calendar: calendarConfigured(),
    todos: listTodos(false, 3),
    briefing: b ? { id: b.id, kind: b.kind, title: BRIEFING_TITLES[b.kind] ?? "Briefing", content: b.content } : null,
  });
}
