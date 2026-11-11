// GET /api/clients — LaunchPad Local clients with their latest Google Maps ranks.
// POST /api/clients {action: "add" | "update" | "check" | "report", ...}
import { addClient, checkClient, clientSnapshot, draftMonthlyReport, getClient, listClients, PLANS, updateClient } from "@/lib/clients/clients";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ plans: PLANS, clients: listClients(true).map((c) => ({ ...c, snapshot: clientSnapshot(c) })) });
}

const list = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((x) => String(x).trim())
    .filter(Boolean);

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "add") {
      if (!String(b.name ?? "").trim() || !String(b.city ?? "").trim() || !list(b.keywords).length)
        return Response.json({ error: "Name, city and at least one search are required." }, { status: 400 });
      const c = addClient({
        name: String(b.name),
        city: String(b.city),
        keywords: list(b.keywords),
        plan: String(b.plan ?? "visibility"),
        contactName: b.contactName ? String(b.contactName) : undefined,
        email: b.email ? String(b.email) : undefined,
        website: b.website ? String(b.website) : undefined,
      });
      return Response.json({ client: c });
    }
    const c = getClient(Number(b.id));
    if (!c) return Response.json({ error: "Client not found." }, { status: 404 });
    if (b.action === "update") {
      const changes: Parameters<typeof updateClient>[1] = {};
      for (const k of ["name", "city", "plan", "contactName", "email", "website", "notes"] as const) if (typeof b[k] === "string") changes[k] = String(b[k]).trim() || null!;
      if (typeof b.status === "string" && ["active", "paused", "ended"].includes(b.status)) changes.status = b.status;
      if (b.keywords !== undefined) changes.keywords = list(b.keywords);
      return Response.json({ client: updateClient(c.id, changes) });
    }
    if (b.action === "check") return Response.json({ results: await checkClient(c) });
    if (b.action === "report") return Response.json({ result: await draftMonthlyReport(c) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
