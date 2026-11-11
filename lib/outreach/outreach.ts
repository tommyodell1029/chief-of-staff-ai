// Outreach: campaigns Tommy approves once, then Jarvis finds decision-makers, emails them on a schedule,
// follows up, and handles replies (simple yes/no automatically; real questions get researched, drafted and
// sent to Tommy for approval).
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AGENCY_NAME, BUSINESS_CONTEXT } from "@/config/business";
import { MODELS } from "@/config/models";
import { runJob, webSearch } from "@/lib/ai";
import { createApproval, createTask, findAgent } from "@/lib/crews/crews";
import { getDb, schema } from "@/lib/db";
import type { Campaign, Lead } from "@/lib/db/schema";
import { cleanDomain, enrichmentConfigured, findDecisionMaker } from "@/lib/integrations/enrich";
import { createReplyDraft, getThread, gmailConnected, myAddress, sendEmail, type ThreadMessage } from "@/lib/integrations/gmail";
import { addToSequence, saleshandyConfigured } from "@/lib/integrations/saleshandy";
import { notifyAll } from "@/lib/push";
import { getSetting } from "@/lib/settings";

const db = () => getDb();

// ---------- Settings Tommy fills in once (Outreach page) ----------

export function outreachSettings() {
  return {
    senderName: getSetting("outreach_sender_name") ?? "",
    businessAddress: getSetting("outreach_address") ?? "", // required by US law (CAN-SPAM) in every cold email
    bookingLink: getSetting("outreach_booking_link") ?? "", // used in automatic replies to "yes"
  };
}

function footer() {
  const s = outreachSettings();
  return `\n\n${s.senderName}\n${s.businessAddress}\n\nNot interested? Just reply "unsubscribe" and I won't email you again.`;
}

// ---------- Campaigns ----------

export function listCampaigns() {
  return db().select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).all();
}

export function getCampaign(id: number) {
  return db().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
}

export interface SaleshandyTarget {
  sequenceId: string;
  sequenceName: string;
  stepId: string;
}

// Checks a Saleshandy sequence choice coming from the page or Jarvis.
export function validTarget(t: unknown): SaleshandyTarget | null {
  const o = t as Partial<SaleshandyTarget> | null | undefined;
  if (!o || typeof o.stepId !== "string" || !o.stepId || typeof o.sequenceId !== "string") return null;
  return { sequenceId: o.sequenceId.slice(0, 64), sequenceName: String(o.sequenceName ?? "").slice(0, 200), stepId: o.stepId.slice(0, 64) };
}

export function createCampaign(c: { name: string; brief: string; businessId?: number; dailyLimit?: number; saleshandy?: SaleshandyTarget | null }): Campaign {
  const row = db()
    .insert(schema.campaigns)
    .values({
      name: c.name,
      brief: c.brief,
      businessId: c.businessId ?? null,
      dailyLimit: Math.min(Math.max(c.dailyLimit ?? 15, 1), 40),
      ...(c.saleshandy
        ? { sendVia: "saleshandy", saleshandySequenceId: c.saleshandy.sequenceId, saleshandySequenceName: c.saleshandy.sequenceName, saleshandyStepId: c.saleshandy.stepId }
        : {}),
    })
    .returning()
    .get();
  // Saleshandy campaigns use the emails written in the Saleshandy sequence, so there's nothing to preview here.
  if (row.sendVia === "jarvis") refreshPreview(row.id).catch((err) => console.error("[outreach] preview failed:", err));
  return row;
}

export function updateCampaign(
  id: number,
  changes: Partial<Pick<Campaign, "name" | "brief" | "dailyLimit" | "followUps">> & { saleshandy?: SaleshandyTarget | null },
) {
  const { saleshandy, ...rest } = changes;
  const before = getCampaign(id);
  const viaChange =
    saleshandy === undefined
      ? {}
      : saleshandy
        ? { sendVia: "saleshandy", saleshandySequenceId: saleshandy.sequenceId, saleshandySequenceName: saleshandy.sequenceName, saleshandyStepId: saleshandy.stepId }
        : { sendVia: "jarvis", saleshandySequenceId: null, saleshandySequenceName: null, saleshandyStepId: null };
  // Any change to what gets sent, or where, means Tommy must look again before it runs.
  const reapprove = rest.brief !== undefined || (saleshandy !== undefined && (saleshandy?.stepId ?? null) !== (before?.saleshandyStepId ?? null));
  const row = db()
    .update(schema.campaigns)
    .set({ ...rest, ...viaChange, ...(reapprove ? { status: "draft", approvedAt: null } : {}) })
    .where(eq(schema.campaigns.id, id))
    .returning()
    .get();
  if (reapprove && row?.sendVia === "jarvis") refreshPreview(id).catch(() => {});
  return row;
}

// What has to be set up before a campaign can run. Without a campaign: what Gmail sending needs.
export function campaignBlockers(campaign?: Campaign): string[] {
  const out: string[] = [];
  if (campaign?.sendVia === "saleshandy") {
    if (!saleshandyConfigured()) out.push("Add SALESHANDY_API_KEY in Render (Connections page).");
    if (!campaign.saleshandyStepId) out.push("Pick the Saleshandy sequence this campaign fills.");
    if (!enrichmentConfigured()) out.push("Add a Saleshandy, Apollo or Hunter key to find decision-makers' emails.");
    return out;
  }
  const s = outreachSettings();
  if (!gmailConnected()) out.push("Connect Google (Connections page).");
  if (!s.senderName) out.push("Add your sender name (Outreach settings).");
  if (!s.businessAddress) out.push("Add your business postal address (required by US law in every cold email).");
  if (!enrichmentConfigured()) out.push("Add a Saleshandy, Apollo or Hunter API key to find decision-makers' emails.");
  return out;
}

export function setCampaignStatus(id: number, status: "active" | "paused" | "stopped", reason?: string) {
  if (status === "active") {
    const blockers = campaignBlockers(getCampaign(id));
    if (blockers.length) throw new Error(blockers.join(" "));
  }
  const row = db()
    .update(schema.campaigns)
    .set({ status, stopReason: reason ?? null, ...(status === "active" ? { approvedAt: new Date() } : {}) })
    .where(eq(schema.campaigns.id, id))
    .returning()
    .get();
  if (status === "active" && row?.sendVia === "saleshandy") setImmediate(() => pushToSaleshandy().catch((err) => console.error("[outreach] saleshandy push failed:", err)));
  return row;
}

export function campaignStats(campaignId: number) {
  const rows = db()
    .select({ status: schema.leads.status, n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .groupBy(schema.leads.status)
    .all();
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const sent = db()
    .select({ n: sql<number>`count(*)` })
    .from(schema.outreachMessages)
    .innerJoin(schema.leads, eq(schema.outreachMessages.leadId, schema.leads.id))
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.outreachMessages.direction, "out")))
    .get()?.n ?? 0;
  return { byStatus: by, sent, leads: rows.reduce((s, r) => s + r.n, 0) };
}

// ---------- Leads ----------

export function listLeads(campaignId: number) {
  return db().select().from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).orderBy(desc(schema.leads.createdAt)).limit(300).all();
}

export function leadMessages(leadId: number) {
  return db().select().from(schema.outreachMessages).where(eq(schema.outreachMessages.leadId, leadId)).orderBy(asc(schema.outreachMessages.createdAt)).all();
}

// Adds companies to a campaign, skipping duplicates and anyone who ever unsubscribed or bounced.
export function addLeads(campaignId: number, companies: { company: string; domain: string; city?: string; phone?: string; notes?: string }[]) {
  const blocked = new Set(
    db()
      .select({ domain: schema.leads.domain, status: schema.leads.status, campaignId: schema.leads.campaignId })
      .from(schema.leads)
      .all()
      .filter((l) => l.campaignId === campaignId || l.status === "unsubscribed" || l.status === "bounced" || l.status === "not_interested")
      .map((l) => l.domain),
  );
  let added = 0;
  for (const c of companies) {
    const domain = cleanDomain(c.domain);
    if (!domain.includes(".") || blocked.has(domain)) continue;
    db()
      .insert(schema.leads)
      .values({ campaignId, company: c.company.trim(), domain, city: c.city ?? null, phone: c.phone ?? null, notes: c.notes ?? null })
      .run();
    blocked.add(domain);
    added++;
  }
  if (added) setImmediate(() => enrichPending().catch((err) => console.error("[outreach] enrich failed:", err)));
  return added;
}

let enriching = false;
// Finds decision-maker emails for new leads, a few at a time (free API credits are limited).
export async function enrichPending(max = 5) {
  if (enriching || !enrichmentConfigured()) return;
  enriching = true;
  try {
    const pending = db().select().from(schema.leads).where(eq(schema.leads.status, "new")).orderBy(asc(schema.leads.createdAt)).limit(max).all();
    for (const lead of pending) {
      const { contact, note } = await findDecisionMaker(lead.domain);
      db()
        .update(schema.leads)
        .set(
          contact
            ? { status: "ready", contactName: contact.name, contactTitle: contact.title, email: contact.email, emailSource: contact.source, emailStatus: contact.status }
            : { status: "no_email", notes: [lead.notes, `No decision-maker email: ${note}`].filter(Boolean).join("\n") },
        )
        .where(eq(schema.leads.id, lead.id))
        .run();
    }
  } finally {
    enriching = false;
  }
  await pushToSaleshandy().catch((err) => console.error("[outreach] saleshandy push failed:", err));
}

// ---------- Saleshandy hand-off (approved Saleshandy campaigns only) ----------

let pushing = false;
// Moves leads with a verified decision-maker email into the campaign's Saleshandy sequence.
// Saleshandy then sends, follows up and tracks replies there, so Jarvis never emails these leads itself.
export async function pushToSaleshandy() {
  if (pushing || !saleshandyConfigured()) return;
  pushing = true;
  try {
    for (const campaign of listCampaigns().filter((c) => c.status === "active" && c.sendVia === "saleshandy" && c.saleshandyStepId)) {
      const ready = db()
        .select()
        .from(schema.leads)
        .where(and(eq(schema.leads.campaignId, campaign.id), eq(schema.leads.status, "ready")))
        .orderBy(asc(schema.leads.createdAt))
        .limit(50)
        .all()
        .filter((l) => l.email);
      if (!ready.length) continue;
      try {
        const { personalLines, categoryOf } = await import("./personalize");
        const lines = await personalLines(ready);
        await addToSequence(
          campaign.saleshandyStepId!,
          ready.map((l) => {
            const [first, ...rest] = (l.contactName ?? "").trim().split(/\s+/);
            return {
              firstName: first ?? "",
              lastName: rest.join(" "),
              email: l.email!,
              company: l.company,
              jobTitle: l.contactTitle,
              phone: l.phone,
              website: l.domain,
              city: l.city,
              category: categoryOf(l.notes) || "local business",
              personalLine: lines.get(l.id),
            };
          }),
          ["Jarvis", campaign.name.slice(0, 40)],
        );
        db().update(schema.leads).set({ status: "in_saleshandy" }).where(inArray(schema.leads.id, ready.map((l) => l.id))).run();
        if (campaign.stopReason?.startsWith("Couldn't add leads to Saleshandy")) {
          db().update(schema.campaigns).set({ stopReason: null }).where(eq(schema.campaigns.id, campaign.id)).run();
        }
      } catch (err) {
        const msg = `Couldn't add leads to Saleshandy: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[outreach] campaign #${campaign.id}:`, msg);
        if (campaign.stopReason !== msg) {
          db().update(schema.campaigns).set({ stopReason: msg }).where(eq(schema.campaigns.id, campaign.id)).run();
          await notifyAll({ title: "Saleshandy hand-off failed", body: `${campaign.name}: ${msg}`.slice(0, 180), url: "/outreach" }).catch(() => {});
        }
      }
    }
  } finally {
    pushing = false;
  }
}

// ---------- Writing emails ----------

interface Written {
  subject: string;
  body: string;
}

async function writeEmail(campaign: Campaign, lead: Lead, kind: "first" | "follow_up", step: number): Promise<Written> {
  let out = null as Written | null; // set by the tool below
  const save = betaZodTool({
    name: "email",
    description: "Return the email.",
    inputSchema: z.object({ subject: z.string().max(80), body: z.string().describe("Plain text. No signature, no footer; those are added automatically.") }),
    run: async (e) => {
      out = e;
      return "Saved.";
    },
  });
  const history = leadMessages(lead.id)
    .filter((m) => m.direction === "out")
    .map((m) => `--- ${m.kind} ---\n${m.body}`)
    .join("\n\n");
  await runJob({
    purpose: "outreach_write",
    model: { ...MODELS.writer, effort: "low" },
    system: `You write cold emails for Tommy's business, following his approved campaign brief exactly. Short (60–120 words), human, specific to this company, one clear question at the end. Never invent facts, results or statistics about the recipient. No income promises, no "replaces your staff" claims, no fake urgency, no links unless the brief includes one.\n${BUSINESS_CONTEXT}`,
    prompt: `Campaign brief (approved by Tommy):\n${campaign.brief}\n\nLead: ${lead.contactName ?? "the owner"} (${lead.contactTitle ?? "decision-maker"}) at ${lead.company}, ${lead.domain}${lead.city ? `, ${lead.city}` : ""}.\nNotes from research: ${lead.notes ?? "none"}\n\n${
      kind === "first" ? "Write the first email." : `Write follow-up #${step} (short, friendly, adds one new reason to reply; same thread so no new pitch). Earlier emails:\n${history}`
    }\nCall the email tool with the subject and body.`,
    tools: [save],
    maxIterations: 3,
    maxTokens: 3000,
  });
  if (!out) throw new Error("No email written");
  return out;
}

// Writes three sample emails so Tommy can see exactly what will go out before approving the campaign.
export async function refreshPreview(campaignId: number) {
  const campaign = getCampaign(campaignId);
  if (!campaign) return;
  const sampleLeads = db()
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.status, "ready")))
    .limit(3)
    .all();
  const examples: Lead[] = sampleLeads.length
    ? sampleLeads
    : [
        { id: 0, campaignId, company: "Example Heating & Air", domain: "example-hvac.com", city: null, contactName: "Mike Johnson", contactTitle: "Owner", email: null, emailSource: null, phone: null, emailStatus: null, notes: "Sample lead (no real leads found yet).", status: "ready", step: 0, threadId: null, lastSentAt: null, lastReplyAt: null, createdAt: new Date() },
      ];
  const parts: string[] = [];
  for (const lead of examples) {
    try {
      const e = await writeEmail(campaign, lead, "first", 1);
      parts.push(`### To ${lead.contactName ?? "the owner"}, ${lead.company}\n**Subject:** ${e.subject}\n\n${e.body}${footer()}`);
    } catch (err) {
      parts.push(`### ${lead.company}\n(Couldn't write a sample: ${err instanceof Error ? err.message : String(err)})`);
    }
  }
  db().update(schema.campaigns).set({ previewMd: parts.join("\n\n---\n\n") }).where(eq(schema.campaigns.id, campaignId)).run();
}

// ---------- Sending (scheduler, every 10 minutes) ----------

function localNow() {
  const tz = process.env.TZ || "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday, hour };
}

export function inSendingWindow() {
  const { weekday, hour } = localNow();
  return !["Sat", "Sun"].includes(weekday) && hour >= 8 && hour < 17;
}

function startOfLocalDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const FOLLOW_UP_DAYS = [0, 3, 4]; // days to wait before follow-up #1 and #2

async function sendOne(campaign: Campaign, lead: Lead) {
  const step = lead.step + 1;
  const kind = lead.step === 0 ? "first" : "follow_up";
  const e = await writeEmail(campaign, lead, kind, step);
  const body = `${e.body}${footer()}`;
  let thread: { threadId: string; inReplyTo?: string; references?: string } | undefined;
  if (lead.threadId) {
    const msgs = await getThread(lead.threadId);
    const last = msgs[msgs.length - 1];
    thread = { threadId: lead.threadId, inReplyTo: last?.messageId, references: [last?.references, last?.messageId].filter(Boolean).join(" ") };
  }
  const subject = lead.step === 0 ? e.subject : `Re: ${leadMessages(lead.id).find((m) => m.kind === "first")?.subject ?? e.subject}`;
  const sent = await sendEmail(lead.email!, subject, body, thread);
  db().insert(schema.outreachMessages).values({ leadId: lead.id, direction: "out", kind, gmailId: sent.id, subject, body }).run();
  db()
    .update(schema.leads)
    .set({ status: "contacted", step, threadId: sent.threadId, lastSentAt: new Date() })
    .where(eq(schema.leads.id, lead.id))
    .run();
}

export async function sendDue(maxPerRun = 2, opts: { ignoreWindow?: boolean } = {}) {
  if (!gmailConnected() || (!opts.ignoreWindow && !inSendingWindow())) return;
  for (const campaign of listCampaigns().filter((c) => c.status === "active" && c.sendVia === "jarvis")) {
    if (campaignBlockers(campaign).length) continue;

    // Safety: pause automatically if too many emails bounce.
    const stats = campaignStats(campaign.id);
    const bounced = stats.byStatus.bounced ?? 0;
    if (stats.sent >= 20 && bounced / stats.sent > 0.05) {
      setCampaignStatus(campaign.id, "paused", `Paused automatically: ${bounced} of ${stats.sent} emails bounced (over 5%).`);
      await notifyAll({ title: "Campaign paused", body: `${campaign.name}: too many bounces. Check the lead list.`, url: "/outreach" }).catch(() => {});
      continue;
    }

    const sentToday = db()
      .select({ n: sql<number>`count(*)` })
      .from(schema.outreachMessages)
      .innerJoin(schema.leads, eq(schema.outreachMessages.leadId, schema.leads.id))
      .where(and(eq(schema.leads.campaignId, campaign.id), eq(schema.outreachMessages.direction, "out"), gte(schema.outreachMessages.createdAt, startOfLocalDay())))
      .get()?.n ?? 0;
    let budget = Math.min(maxPerRun, campaign.dailyLimit - sentToday);
    if (budget <= 0) continue;

    const now = Date.now();
    const followUps = db()
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.campaignId, campaign.id), eq(schema.leads.status, "contacted")))
      .all()
      .filter((l) => l.step <= campaign.followUps && l.lastSentAt && now - l.lastSentAt.getTime() > (FOLLOW_UP_DAYS[l.step] ?? 99) * 86_400_000);
    const fresh = db()
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.campaignId, campaign.id), eq(schema.leads.status, "ready")))
      .orderBy(asc(schema.leads.createdAt))
      .limit(budget)
      .all();
    for (const lead of [...followUps, ...fresh]) {
      if (budget-- <= 0) break;
      try {
        await sendOne(campaign, lead);
      } catch (err) {
        console.error(`[outreach] send to lead #${lead.id} failed:`, err);
        db().update(schema.leads).set({ notes: [lead.notes, `Send failed: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join("\n") }).where(eq(schema.leads.id, lead.id)).run();
      }
    }
    // Leads that got every follow-up and never replied are finished.
    db()
      .update(schema.leads)
      .set({ status: "done" })
      .where(and(eq(schema.leads.campaignId, campaign.id), eq(schema.leads.status, "contacted"), sql`${schema.leads.step} > ${campaign.followUps}`, sql`${schema.leads.lastSentAt} < ${now - 7 * 86_400_000}`))
      .run();
  }
}

// ---------- Replies (scheduler, every 10 minutes) ----------

// LaunchPad Local's next step after a "yes" is the free 5-point audit: the Audit Desk starts on it right away.
// The finished audit comes to Tommy as a draft for approval; nothing is sent without him.
export function startAudit(lead: Pick<Lead, "company" | "domain" | "contactName" | "notes" | "email">, reply: string) {
  const { agent: auditDesk } = findAgent(AGENCY_NAME, "Audit Desk");
  if (!auditDesk || auditDesk.status !== "active") return false;
  createTask(
    auditDesk.id,
    `Write the free 5-point audit for ${lead.company} (${lead.domain}${lead.contactName ? `, contact ${lead.contactName}` : ""}). They said yes to an outreach email. Prospector notes: ${lead.notes ?? "none"}. Their reply: ${reply.slice(0, 500)}. Draft it to ${lead.email} with email_draft.`,
  );
  return true;
}

export type ReplyKind = "yes" | "no" | "unsubscribe" | "auto_reply" | "bounce" | "question";

export async function classify(reply: string): Promise<ReplyKind> {
  let kind: ReplyKind = "question";
  const tool = betaZodTool({
    name: "classify",
    description: "Classify the reply.",
    inputSchema: z.object({ kind: z.enum(["yes", "no", "unsubscribe", "auto_reply", "question"]) }),
    run: async (r) => {
      kind = r.kind;
      return "ok";
    },
  });
  await runJob({
    purpose: "outreach_classify",
    model: MODELS.worker,
    system: `Classify a reply to a cold email. Be conservative:
- yes: a plain yes / interested / "sure, call me" / "send me info" with NO question or condition that needs a real answer.
- no: a plain no / not interested / already have something.
- unsubscribe: asks to stop, remove, unsubscribe, or is angry about being emailed.
- auto_reply: out-of-office or automatic message.
- question: anything else (questions, pricing, conditions, objections, mixed messages). When unsure, choose question.`,
    prompt: reply.slice(0, 3000),
    tools: [tool],
    maxIterations: 2,
    maxTokens: 500,
  });
  return kind;
}

export async function checkReplies() {
  if (!gmailConnected()) return;
  const me = myAddress();
  const watching = db()
    .select()
    .from(schema.leads)
    .where(inArray(schema.leads.status, ["contacted", "interested", "replied"]))
    .all()
    .filter((l) => l.threadId);
  for (const lead of watching) {
    let msgs: ThreadMessage[];
    try {
      msgs = await getThread(lead.threadId!);
    } catch {
      continue;
    }
    const known = new Set(leadMessages(lead.id).map((m) => m.gmailId));
    for (const m of msgs) {
      if (known.has(m.id)) continue;
      const fromMe = me && m.from.toLowerCase().includes(me);
      if (fromMe) continue; // e.g. Tommy replied himself from Gmail
      db().insert(schema.outreachMessages).values({ leadId: lead.id, direction: "in", kind: "reply_in", gmailId: m.id, subject: m.subject, body: m.body }).run();
      await handleReply(lead, m, msgs);
    }
  }
}

async function handleReply(lead: Lead, m: ThreadMessage, thread: ThreadMessage[]) {
  const set = (changes: Partial<Lead>) => db().update(schema.leads).set({ lastReplyAt: new Date(), ...changes }).where(eq(schema.leads.id, lead.id)).run();
  const kind: ReplyKind = /mailer-daemon|postmaster/i.test(m.from) ? "bounce" : await classify(m.body);
  const campaign = lead.campaignId ? getCampaign(lead.campaignId) : undefined;
  const threadRef = { threadId: lead.threadId!, inReplyTo: m.messageId, references: [m.references, m.messageId].filter(Boolean).join(" ") };
  const subject = m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`;

  switch (kind) {
    case "bounce":
      set({ status: "bounced" });
      return;
    case "auto_reply":
      return; // keep the follow-up schedule
    case "unsubscribe":
      set({ status: "unsubscribed" });
      return;
    case "no":
      set({ status: "not_interested" });
      return;
    case "yes": {
      // A plain yes gets an immediate, short reply with the next step.
      const { bookingLink } = outreachSettings();
      const reply = await quickYesReply(campaign, lead, m.body, bookingLink);
      const sent = await sendEmail(lead.email!, subject, `${reply}${footer()}`, threadRef);
      db().insert(schema.outreachMessages).values({ leadId: lead.id, direction: "out", kind: "auto_reply", gmailId: sent.id, subject, body: reply }).run();
      set({ status: "interested" });
      // LaunchPad Local's next step is the free 5-point audit, so the Audit Desk starts on it right away.
      // The finished audit comes to Tommy as a draft for approval; nothing is sent without him.
      startAudit(lead, m.body);
      await notifyAll({ title: `🔥 ${lead.company} is interested`, body: m.body.slice(0, 160), url: "/outreach" }).catch(() => {});
      return;
    }
    case "question": {
      // Think and research, draft a real answer, and ask Tommy before it goes out.
      set({ status: "needs_review" });
      const draft = await researchedReply(campaign, lead, thread);
      const d = await createReplyDraft(lead.email!, subject, `${draft}${footer()}`, threadRef);
      createApproval({
        what: `Reply to ${lead.contactName ?? lead.company} (${lead.company}): "${m.body.slice(0, 160)}${m.body.length > 160 ? "…" : ""}"\n\nDraft answer:\n${draft}`,
        why: "They asked something that needs a real answer. Jarvis researched it and drafted this reply (also in your Gmail drafts).",
        action: { type: "gmail_send", draftId: d.id, to: lead.email!, subject, leadId: lead.id, body: draft },
      });
      return;
    }
  }
}

async function quickYesReply(campaign: Campaign | undefined, lead: Lead, reply: string, bookingLink: string) {
  let text = "";
  const tool = betaZodTool({
    name: "reply",
    description: "Return the reply body.",
    inputSchema: z.object({ body: z.string() }),
    run: async (r) => {
      text = r.body;
      return "ok";
    },
  });
  await runJob({
    purpose: "outreach_yes_reply",
    model: { ...MODELS.writer, effort: "low" },
    system: `You reply for Tommy to a prospect who just said yes. 2–4 sentences, warm, no new pitch. Give the next step from the campaign brief. LaunchPad Local works by email, with no sales calls: if they asked for the free audit, thank them and say it's on the way by email within 2 business days; if their Google listing isn't clear from the thread, ask them to confirm the business name or listing link. ${bookingLink ? `Only if they asked to talk, offer this link: ${bookingLink}` : "Don't ask for a call."} No signature (added automatically).`,
    prompt: `Campaign: ${campaign?.brief ?? ""}\nProspect: ${lead.contactName ?? ""} at ${lead.company}\nTheir reply: ${reply}`,
    tools: [tool],
    maxIterations: 2,
    maxTokens: 1500,
  });
  return text || "Great, thanks! I'll put together your free 5-point audit and email it to you within 2 business days. If you have more than one location, just reply with the one you'd like me to look at.";
}

async function researchedReply(campaign: Campaign | undefined, lead: Lead, thread: ThreadMessage[]) {
  const convo = thread.map((t) => `From: ${t.from}\n${t.body}`).join("\n\n---\n\n");
  const job = await runJob({
    purpose: "outreach_researched_reply",
    model: { ...MODELS.writer, effort: "medium" },
    system: `You are drafting Tommy's reply to a prospect's question. First think about what they really need to know; research anything factual (their business, pricing norms, how the service works) with web search. Then write a clear, honest, friendly answer, 60–180 words. Never invent capabilities, results or prices that aren't in the campaign brief; if something needs Tommy to decide, say so in [brackets] for him. Reply with ONLY the email body, no signature.\n${BUSINESS_CONTEXT}`,
    prompt: `Campaign brief:\n${campaign?.brief ?? ""}\n\nProspect: ${lead.contactName ?? ""} (${lead.contactTitle ?? ""}) at ${lead.company}, ${lead.domain}\n\nConversation so far:\n${convo}`,
    tools: [webSearch(MODELS.writer.id, 3)],
    maxIterations: 6,
  });
  return job.text;
}

// Called after Tommy approves a drafted reply and it's sent.
export function recordApprovedReply(leadId: number, gmailId: string, subject: string, body: string) {
  db().insert(schema.outreachMessages).values({ leadId, direction: "out", kind: "approved_reply", gmailId, subject, body }).run();
  db().update(schema.leads).set({ status: "replied" }).where(eq(schema.leads.id, leadId)).run();
}
