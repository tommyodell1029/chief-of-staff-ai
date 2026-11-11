// GET /api/builds — every done-for-you build with its plan, checklist and warm-up countdown.
// POST /api/builds {client, email?} — start a new build. {signup, handled} marks a sales-page sign-up handled.
import { buildView, createBuild, listBuilds } from "@/lib/builds/builds";
import { listSignups, markSignup } from "@/lib/builds/signups";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ builds: listBuilds().map(buildView), signups: listSignups() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { client?: string; email?: string; signup?: number; handled?: boolean };
  if (b.signup) {
    markSignup(b.signup, b.handled ?? true);
    return Response.json({ ok: true });
  }
  if (!b.client?.trim()) return Response.json({ error: "Client name is required." }, { status: 400 });
  return Response.json({ build: buildView(createBuild(b.client, b.email)) });
}
