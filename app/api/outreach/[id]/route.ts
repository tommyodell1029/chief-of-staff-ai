// GET — a campaign with its leads. PATCH — edit (a new brief or Saleshandy sequence sends it back to draft for approval).
// POST {action}: approve | pause | stop | preview | find (ask the Prospector for companies) | add (companies list).
import { AGENCY_NAME } from "@/config/business";
import { createTask, findAgent } from "@/lib/crews/crews";
import { addLeads, campaignBlockers, campaignStats, getCampaign, listLeads, refreshPreview, setCampaignStatus, updateCampaign, validTarget } from "@/lib/outreach/outreach";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const campaign = getCampaign(id);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ campaign, stats: campaignStats(id), blockers: campaignBlockers(campaign), leads: listLeads(id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as { name?: string; brief?: string; dailyLimit?: number; followUps?: number; saleshandy?: unknown };
  const changes: Parameters<typeof updateCampaign>[1] = {};
  // saleshandy: a sequence to fill, or null to switch back to sending from Gmail. Either sends it back for approval.
  if (b.saleshandy !== undefined) changes.saleshandy = validTarget(b.saleshandy);
  if (b.name?.trim()) changes.name = b.name.trim();
  if (b.brief?.trim()) changes.brief = b.brief.trim();
  if (typeof b.dailyLimit === "number") changes.dailyLimit = Math.min(Math.max(Math.round(b.dailyLimit), 1), 40);
  if (typeof b.followUps === "number") changes.followUps = Math.min(Math.max(Math.round(b.followUps), 0), 3);
  return Response.json({ campaign: updateCampaign(id, changes) });
}

export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as {
    action?: string;
    city?: string;
    count?: number;
    companies?: { company: string; domain: string; city?: string }[];
  };
  const campaign = getCampaign(id);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    switch (b.action) {
      case "approve":
        return Response.json({ campaign: setCampaignStatus(id, "active") });
      case "pause":
        return Response.json({ campaign: setCampaignStatus(id, "paused") });
      case "stop":
        return Response.json({ campaign: setCampaignStatus(id, "stopped") });
      case "preview":
        await refreshPreview(id);
        return Response.json({ campaign: getCampaign(id) });
      case "add":
        return Response.json({ added: addLeads(id, b.companies ?? []) });
      case "find": {
        const { business, agent } = findAgent(AGENCY_NAME, "Prospector");
        if (!agent) return Response.json({ error: "Set up your businesses first." }, { status: 400 });
        if (agent.status !== "active") return Response.json({ error: `Approve the ${business?.name} crew first.` }, { status: 400 });
        const n = Math.min(Math.max(b.count ?? 15, 5), 40);
        const task = createTask(
          agent.id,
          `Find ${n} qualified companies for the outreach campaign "${campaign.name}"${b.city ? ` in ${b.city}` : ""}. Campaign brief:\n${campaign.brief}\n\nUse maps_search first. Add them with add_leads (campaign "${campaign.name}"), with their real website domain, phone and a one-line note of the Google Maps facts that make each one qualify.`,
          "tommy",
        );
        return Response.json({ task });
      }
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
