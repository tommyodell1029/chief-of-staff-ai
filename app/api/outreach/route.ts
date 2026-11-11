// GET /api/outreach — campaigns with numbers, outreach settings, and anything blocking sending.
// POST — create a campaign (optionally filling a Saleshandy sequence instead of sending from Gmail). PUT — save outreach settings (sender name, postal address, booking link).
import { AGENCY_NAME } from "@/config/business";
import { findAgent } from "@/lib/crews/crews";
import { campaignBlockers, campaignStats, createCampaign, listCampaigns, outreachSettings, validTarget, type SaleshandyTarget } from "@/lib/outreach/outreach";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    campaigns: listCampaigns().map((c) => ({ ...c, stats: campaignStats(c.id), blockers: campaignBlockers(c) })),
    settings: outreachSettings(),
    blockers: campaignBlockers(),
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; brief?: string; dailyLimit?: number; saleshandy?: SaleshandyTarget | null };
  if (!b.name?.trim() || !b.brief?.trim()) return Response.json({ error: "Name and brief are required." }, { status: 400 });
  const c = createCampaign({
    name: b.name.trim(),
    brief: b.brief.trim(),
    dailyLimit: b.dailyLimit,
    businessId: findAgent(AGENCY_NAME, "Prospector").business?.id,
    saleshandy: validTarget(b.saleshandy),
  });
  return Response.json({ campaign: c });
}

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { senderName?: string; businessAddress?: string; bookingLink?: string };
  if (typeof b.senderName === "string") setSetting("outreach_sender_name", b.senderName.trim().slice(0, 100));
  if (typeof b.businessAddress === "string") setSetting("outreach_address", b.businessAddress.trim().slice(0, 300));
  if (typeof b.bookingLink === "string") setSetting("outreach_booking_link", b.bookingLink.trim().slice(0, 300));
  return Response.json({ settings: outreachSettings() });
}
