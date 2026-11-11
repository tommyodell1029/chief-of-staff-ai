// GET /api/audits — recent walk-in audits. POST /api/audits {business, city, searches, website?} — run one.
import { listAudits, runWalkinAudit } from "@/lib/audits/walkin";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ audits: listAudits() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { business?: string; city?: string; searches?: string | string[]; website?: string };
  const searches = (Array.isArray(b.searches) ? b.searches : String(b.searches ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
  try {
    const a = await runWalkinAudit({ business: b.business ?? "", city: b.city ?? "Jacksonville, FL", searches, website: b.website });
    return Response.json({ audit: { id: a.id } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
