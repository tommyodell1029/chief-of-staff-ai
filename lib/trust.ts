// The trust ladder. Jarvis watches how Tommy decides each kind of action. After a streak of approvals with no
// changes, he offers to handle that kind on his own (autopilot), within a daily cap. Tommy can switch any lane back
// to "ask me" at any time; a failed autopilot action switches it back automatically. Money, phone calls, contracts
// and anything without a lane below never leave the approval gate.
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ApprovalAction } from "@/lib/integrations/actions";
import { getSetting, setSetting } from "@/lib/settings";

export type Lane = "nina_post" | "nina_ad" | "etsy_listing" | "crew_email" | "prospect_reply";

export interface LaneInfo {
  label: string;
  detail: string;
  streak: number; // clean approvals in a row before Jarvis offers autopilot
  dailyCap: number; // autopilot actions per 24 hours; beyond that he asks again
}

export const LANES: Record<Lane, LaneInfo> = {
  nina_post: {
    label: "Nina's lifestyle posts",
    detail: "Approve the Content Planner's posts: Instagram goes out, other platforms get a share package.",
    streak: 10,
    dailyCap: 2,
  },
  nina_ad: {
    label: "Nina's Etsy posts",
    detail: "Approve the UGC Ad Maker's labeled posts for the Etsy shop (organic posts, no ad spend).",
    streak: 10,
    dailyCap: 1,
  },
  etsy_listing: {
    label: "Publishing Etsy listings",
    detail: "Publish the Shop Marketer's new listings ($0.20 Etsy listing fee each).",
    streak: 8,
    dailyCap: 3,
  },
  crew_email: {
    label: "Emails your crews write",
    detail: "Send customer, client and crew emails drafted in Gmail.",
    streak: 15,
    dailyCap: 5,
  },
  prospect_reply: {
    label: "Replies to prospects",
    detail: "Send replies to LaunchPad Local prospects who answered the outreach (Gmail or Saleshandy).",
    streak: 15,
    dailyCap: 10,
  },
};

export const LANE_IDS = Object.keys(LANES) as Lane[];
const DAY = 24 * 3600 * 1000;
const db = () => getDb();

// Which lane an approval belongs to. Undefined = never eligible for autopilot.
export function laneForAction(action: ApprovalAction | undefined, fromAgent: boolean): Lane | undefined {
  if (!action) return undefined;
  switch (action.type) {
    case "printify_publish":
      return "etsy_listing";
    case "saleshandy_reply":
      return "prospect_reply";
    case "gmail_send":
      if (action.leadId) return "prospect_reply";
      return fromAgent ? "crew_email" : undefined; // an email Tommy asked Jarvis for is a one-off
    default:
      return undefined; // payment links, phone calls, trust changes
  }
}

export function laneForPost(caption: string): Lane {
  return /^(#?ad\b|ad\s*[:·|-])/i.test(caption.trim()) ? "nina_ad" : "nina_post";
}

// ---------- Mode ----------

export function laneAuto(lane: Lane): boolean {
  // Etsy listings keep the older auto-publish switch on the Connections page as their source of truth.
  if (lane === "etsy_listing") return getSetting("etsy_autopublish") === "1";
  return getSetting(`trust:${lane}`) === "auto";
}

export function setLaneAuto(lane: Lane, auto: boolean) {
  if (lane === "etsy_listing") setSetting("etsy_autopublish", auto ? "1" : "0");
  else setSetting(`trust:${lane}`, auto ? "auto" : "manual");
  // Changing the mode starts a fresh streak.
  setSetting(`trust_since:${lane}`, String(Date.now()));
}

function since(lane: Lane): Date {
  return new Date(Number(getSetting(`trust_since:${lane}`) ?? 0));
}

// ---------- Events ----------

export function recordTrust(lane: Lane, outcome: "approved" | "edited" | "denied" | "auto" | "failed", summary?: string) {
  db().insert(schema.trustEvents).values({ lane, outcome, summary: summary?.slice(0, 300) ?? null, createdAt: new Date() }).run();
  if (outcome === "approved") void maybeOffer(lane);
}

// Clean approvals in a row (newest first) since the last edit, denial, failure or mode change.
export function currentStreak(lane: Lane): number {
  const rows = db()
    .select()
    .from(schema.trustEvents)
    .where(and(eq(schema.trustEvents.lane, lane), gte(schema.trustEvents.createdAt, since(lane))))
    .orderBy(desc(schema.trustEvents.createdAt), desc(schema.trustEvents.id))
    .limit(100)
    .all();
  let n = 0;
  for (const r of rows) {
    if (r.outcome === "approved") n++;
    else if (r.outcome === "auto") continue;
    else break;
  }
  return n;
}

export function autoToday(lane: Lane): number {
  return db()
    .select()
    .from(schema.trustEvents)
    .where(and(eq(schema.trustEvents.lane, lane), eq(schema.trustEvents.outcome, "auto"), gte(schema.trustEvents.createdAt, new Date(Date.now() - DAY))))
    .all().length;
}

// Should this action go ahead without asking? (Lane on autopilot and under today's cap.)
export function canAutopilot(lane: Lane | undefined): lane is Lane {
  return !!lane && laneAuto(lane) && autoToday(lane) < LANES[lane].dailyCap;
}

// An autopilot action failed: back to "ask me", and tell Tommy.
export async function autopilotFailed(lane: Lane, what: string, error: string) {
  recordTrust(lane, "failed", `${what}: ${error}`);
  setLaneAuto(lane, false);
  const { notifyAll } = await import("@/lib/push");
  await notifyAll({
    title: "Autopilot paused",
    body: `${LANES[lane].label}: "${what.slice(0, 80)}" failed (${error.slice(0, 100)}). I'll ask you again for these until you turn autopilot back on.`,
    url: "/trust",
    tag: `trust-${lane}`,
  }).catch(() => {});
}

export async function autopilotDone(lane: Lane, what: string, result: string) {
  const { notifyAll } = await import("@/lib/push");
  await notifyAll({
    title: "Done on autopilot",
    body: `${LANES[lane].label}: ${what.slice(0, 100)}. ${result.slice(0, 100)}`,
    url: "/trust",
    tag: `trust-done-${Date.now()}`,
    station: false,
  }).catch(() => {});
}

// When a lane's streak reaches its mark, ask Tommy (once per streak) whether Jarvis may take it over.
async function maybeOffer(lane: Lane) {
  if (laneAuto(lane)) return;
  const info = LANES[lane];
  const streak = currentStreak(lane);
  if (streak < info.streak) return;
  const pending = db()
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.status, "pending"))
    .all()
    .some((a) => a.action?.includes(`"trust_promote"`) && a.action.includes(`"${lane}"`));
  if (pending) return;
  const { createApproval } = await import("@/lib/crews/crews");
  createApproval({
    what: `Let me handle "${info.label}" on my own?`,
    why: `You've approved the last ${streak} without changes. On autopilot I'd do these myself (up to ${info.dailyCap} a day), tell you each time, and switch back to asking you if anything fails. You can turn it off anytime on the Trust page or just tell me.`,
    action: { type: "trust_promote", lane },
  });
}

// Tommy said no to the offer: start counting again from now.
export function declineOffer(lane: Lane) {
  setSetting(`trust_since:${lane}`, String(Date.now()));
}

// ---------- Overview ----------

export function trustOverview() {
  const lanes = LANE_IDS.map((id) => ({
    id,
    ...LANES[id],
    auto: laneAuto(id),
    current: currentStreak(id),
    autoToday: autoToday(id),
  }));
  const recent = db()
    .select()
    .from(schema.trustEvents)
    .where(gte(schema.trustEvents.createdAt, new Date(Date.now() - 14 * DAY)))
    .orderBy(desc(schema.trustEvents.createdAt), desc(schema.trustEvents.id))
    .limit(30)
    .all()
    .filter((e) => e.outcome === "auto" || e.outcome === "failed")
    .map((e) => ({ lane: e.lane, label: LANES[e.lane as Lane]?.label ?? e.lane, outcome: e.outcome, summary: e.summary, at: e.createdAt }));
  return { lanes, recent };
}

// For Jarvis's voice: a short status line per lane.
export function trustText(): string {
  return trustOverview()
    .lanes.map((l) => `${l.label}: ${l.auto ? `autopilot (${l.autoToday}/${l.dailyCap} today)` : `asks you (${l.current}/${l.streak} clean approvals toward autopilot)`}`)
    .join("\n");
}

export function findLane(text: string): Lane | undefined {
  const t = text.toLowerCase();
  if ((LANE_IDS as string[]).includes(t)) return t as Lane;
  if (/etsy.*(post|ad|ugc)|ugc|nina.*(ad|etsy)/.test(t)) return "nina_ad";
  if (/nina|post/.test(t)) return "nina_post";
  if (/listing|publish/.test(t)) return "etsy_listing";
  if (/prospect|lead|outreach|saleshandy|launchpad/.test(t)) return "prospect_reply";
  if (/email|customer|client|crew/.test(t)) return "crew_email";
  return undefined;
}
