// GET /api/diagnostics[?quick=1] — every system Jarvis depends on. quick = configuration only (the station's boot readout).
import { diagnosticsSummary, runDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const quick = new URL(req.url).searchParams.get("quick") === "1";
  const systems = await runDiagnostics(quick);
  return Response.json({ systems, summary: diagnosticsSummary(systems) });
}
