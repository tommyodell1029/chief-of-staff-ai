// The client's assistant (kit mode): GET → setup file, readiness checklist, launch state.
// POST {action: "import", profile} | {action: "launch"} | {action: "pause"} | {action: "warmup_done"}
import { createKitCrews } from "@/lib/kit/crews";
import { kitMode, kitProfile, saveKitProfile } from "@/lib/kit/kit";
import { launch, launched, pause, paused, readiness } from "@/lib/kit/launch";
import { parseProfile } from "@/lib/kit/profile";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!kitMode()) return Response.json({ kit: false });
  return Response.json({ kit: true, profile: kitProfile(), readiness: await readiness(), launched: launched(), paused: paused() });
}

export async function POST(req: Request) {
  if (!kitMode()) return Response.json({ error: "Only on client assistants (KIT_MODE=1)." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; profile?: unknown };
  try {
    if (b.action === "import") {
      const p = parseProfile(typeof b.profile === "string" ? JSON.parse(b.profile) : b.profile);
      saveKitProfile(p);
      const created = createKitCrews(p);
      return Response.json({ ok: true, created, message: `Set up ${p.assistant.name} for ${p.owner.name}: ${created} new business${created === 1 ? "" : "es"} with their crews (waiting for Launch).` });
    }
    if (b.action === "launch") return Response.json({ ok: true, message: await launch() });
    if (b.action === "pause") return Response.json({ ok: true, message: await pause() });
    if (b.action === "warmup_done") {
      setSetting("kit_warmup_done", "1");
      return Response.json({ ok: true });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
