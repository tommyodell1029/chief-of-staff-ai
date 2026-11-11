// The Launch screen on a client's assistant: a readiness checklist, then one button that turns everything on
// (crews active, outreach campaign approved). Until then nothing runs and nothing sends.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { gmailConnected } from "@/lib/integrations/gmail";
import { telegramPaired } from "@/lib/integrations/telegram";
import { providerProblem } from "@/lib/llm/compat";
import { getSetting, setSetting } from "@/lib/settings";
import { kitProfile } from "./kit";
import { warmupReadyDate } from "./profile";

export interface ReadyItem {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: { label: string; href?: string; action?: string };
}

export function launched(): number | null {
  const v = Number(getSetting("kit_launched") || 0);
  return v || null;
}

export async function readiness(now = Date.now()): Promise<ReadyItem[]> {
  const db = getDb();
  const p = kitProfile();
  const items: ReadyItem[] = [];
  items.push({ id: "profile", label: "Assistant set up", ok: !!p, required: true, detail: p ? `${p.assistant.name} for ${p.owner.name}` : "Name your assistant (or import the setup file from your kickoff call).", fix: p ? undefined : { label: "Set up", href: "/setup" } });
  const problem = providerProblem();
  items.push({ id: "brain", label: "AI brain connected", ok: !problem, required: true, detail: problem ?? "Ready", fix: problem ? { label: "Connections", href: "/connections" } : undefined });
  const businesses = db.select().from(schema.businesses).all();
  items.push({ id: "crews", label: "Crews built", ok: businesses.length > 0, required: true, detail: businesses.length ? `${businesses.length} business${businesses.length === 1 ? "" : "es"}, ${db.select().from(schema.agents).all().length} agents` : "Tell your assistant what business you want to run (or import a setup file).", fix: businesses.length ? undefined : { label: "Add a business", href: "/ideas" } });
  const voice = !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
  items.push({ id: "voice", label: "Voice set up", ok: voice, required: false, detail: voice ? "Ready" : "Optional: add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in Render for spoken answers." });

  if (p?.outreach) {
    const { campaignBlockers } = await import("@/lib/outreach/outreach");
    const campaign = db.select().from(schema.campaigns).all()[0];
    const blockers = campaign ? campaignBlockers(campaign) : ["No outreach campaign yet (import the setup file)."];
    items.push({ id: "sending", label: "Email sending set up", ok: blockers.length === 0, required: true, detail: blockers.length ? blockers.join(" ") : campaign.sendVia === "saleshandy" ? "Saleshandy sequence connected" : "Gmail connected", fix: blockers.length ? { label: "Connections", href: "/connections" } : undefined });
    const ready = warmupReadyDate(p);
    const confirmed = !!getSetting("kit_warmup_done");
    const warm = confirmed || (!!ready && ready.getTime() <= now);
    const daysLeft = ready ? Math.max(0, Math.ceil((ready.getTime() - now) / 86_400_000)) : null;
    items.push({
      id: "warmup",
      label: "Mailboxes warmed up",
      ok: warm,
      required: true,
      detail: warm ? "Done" : daysLeft !== null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} to go (ready ${ready!.toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : "Warm-up start date not set.",
      fix: warm ? undefined : { label: "It's done: mark warmed up", action: "warmup_done" },
    });
    const leads = campaign ? db.select().from(schema.leads).where(eq(schema.leads.campaignId, campaign.id)).all().length : 0;
    items.push({ id: "prospects", label: "First prospects found", ok: leads >= 10, required: false, detail: leads ? `${leads} ready` : "The Prospector finds more after launch too." });
  } else {
    items.push({ id: "google", label: "Gmail and Calendar connected", ok: gmailConnected(), required: false, detail: gmailConnected() ? "Connected" : "Optional: lets the assistant read email and your calendar.", fix: gmailConnected() ? undefined : { label: "Connections", href: "/connections" } });
  }
  items.push({ id: "telegram", label: "Telegram connected", ok: telegramPaired(), required: false, detail: telegramPaired() ? "Connected" : "Optional: chat and approve from Telegram." });
  return items;
}

// Turn everything on: every crew active, the outreach campaign approved. Refuses if something required isn't ready.
export async function launch(): Promise<string> {
  const items = await readiness();
  const missing = items.filter((i) => i.required && !i.ok);
  if (missing.length) throw new Error(`Not ready yet: ${missing.map((m) => m.label).join(", ")}.`);
  const db = getDb();
  const { setCrewStatus } = await import("@/lib/crews/crews");
  const { setCampaignStatus } = await import("@/lib/outreach/outreach");
  for (const b of db.select().from(schema.businesses).all()) setCrewStatus(b.id, "active");
  let campaigns = 0;
  for (const c of db.select().from(schema.campaigns).all()) {
    if (c.status === "active") continue;
    setCampaignStatus(c.id, "active");
    campaigns++;
  }
  setSetting("kit_launched", String(Date.now()));
  setSetting("kit_paused", "");
  const { notifyAll } = await import("@/lib/push");
  await notifyAll({ title: "Launched", body: `Your crews are working${campaigns ? " and outreach is live" : ""}. Anything that sends, spends or posts still comes to you first.`, url: "/deck", tag: "kit-launch" }).catch(() => {});
  return `Launched: ${db.select().from(schema.businesses).all().length} crew${campaigns ? "s and outreach" : "s"} running.`;
}

export async function pause(): Promise<string> {
  const db = getDb();
  const { setCrewStatus } = await import("@/lib/crews/crews");
  const { setCampaignStatus } = await import("@/lib/outreach/outreach");
  for (const b of db.select().from(schema.businesses).all()) setCrewStatus(b.id, "paused");
  for (const c of db.select().from(schema.campaigns).all()) if (c.status === "active") setCampaignStatus(c.id, "paused", "Paused from the Launch screen");
  setSetting("kit_paused", String(Date.now()));
  return "Paused: crews and outreach are stopped. Launch again any time.";
}

export const paused = () => !!getSetting("kit_paused");
