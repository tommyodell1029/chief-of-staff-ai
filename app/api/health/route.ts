// GET /api/health — lets Render check that Jarvis is up. Public, reveals nothing.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}
