// What happens when Saleshandy tells Jarvis something (webhook): replies get sorted and answered with Tommy's
// approval, bounces and unsubscribes update the lead, and mailbox problems become phone alerts.
// Saleshandy's payload format isn't fully documented, so fields are found by name anywhere in the payload.
import { eq } from "drizzle-orm";
import { BUSINESS_CONTEXT } from "@/config/business";
import { MODELS } from "@/config/models";
import { runJob, webSearch } from "@/lib/ai";
import { createApproval } from "@/lib/crews/crews";
import { getDb, schema } from "@/lib/db";
import type { Lead } from "@/lib/db/schema";
import { findField } from "@/lib/integrations/saleshandy";
import { notifyAll } from "@/lib/push";
import { setSetting } from "@/lib/settings";
import { classify, startAudit } from "./outreach";

const db = () => getDb();
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/i;

const stripHtml = (h: string) =>
  h
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Drop the quoted original ("On Tue, … wrote:") so only their new words are read.
const newPart = (t: string) => t.split(/\n\s*On .{5,80} wrote:|\n-{2,}\s*Original Message|\n>/)[0].trim();

function prospectEmail(p: unknown): string | null {
  const direct = findField(p, /^(prospectEmail|prospect_email|email|fromEmail|from_email|from)$/i);
  const m = direct?.match(EMAIL) ?? JSON.stringify(p).match(EMAIL);
  return m ? m[0].toLowerCase() : null;
}

function leadByEmail(email: string | null): Lead | undefined {
  if (!email) return undefined;
  return db().select().from(schema.leads).where(eq(schema.leads.email, email)).get();
}

export function recordSaleshandyReply(leadId: number, body: string) {
  db().insert(schema.outreachMessages).values({ leadId, direction: "out", kind: "approved_reply", body }).run();
  db().update(schema.leads).set({ status: "replied" }).where(eq(schema.leads.id, leadId)).run();
}

async function draftAnswer(who: string, company: string, notes: string | null, reply: string, yes: boolean) {
  const job = await runJob({
    purpose: "saleshandy_reply_draft",
    model: { ...MODELS.writer, effort: yes ? "low" : "medium" },
    system: yes
      ? `Draft Tommy's short reply (2–4 sentences) to a business owner who said yes to LaunchPad Local's free 5-point audit. Thank them; say the audit will be emailed within 2 business days; if their business or Google listing isn't clear, ask them to confirm it. No call, no pitch. No signature (Saleshandy adds it). Reply with ONLY the email body.\n${BUSINESS_CONTEXT}`
      : `Draft Tommy's reply to a prospect's question about LaunchPad Local. Think about what they really need to know; research facts with web search if needed. Clear, honest, friendly, 60–160 words. Only use offers and prices from the business context; never guarantee rankings; if something needs Tommy to decide, put it in [brackets]. No signature (Saleshandy adds it). Reply with ONLY the email body.\n${BUSINESS_CONTEXT}`,
    prompt: `Prospect: ${who} at ${company}\nWhat we know: ${notes ?? "nothing yet"}\n\nTheir reply:\n${reply.slice(0, 3000)}`,
    tools: yes ? [] : [webSearch(MODELS.writer.id, 3)],
    maxIterations: yes ? 2 : 6,
  });
  return job.text.trim();
}

export async function handleSaleshandyEvent(event: string, payload: unknown) {
  setSetting("saleshandy_last_event", JSON.stringify({ event, at: new Date().toISOString(), payload }).slice(0, 20_000));
  const email = prospectEmail(payload);
  const lead = leadByEmail(email);
  const name = lead?.contactName ?? findField(payload, /^(firstName|first_name|prospectName|name)$/i) ?? email ?? "a prospect";
  const company = lead?.company ?? findField(payload, /^(company|companyName|company_name)$/i) ?? "";
  const setLead = (status: string) => lead && db().update(schema.leads).set({ status, lastReplyAt: new Date() }).where(eq(schema.leads.id, lead.id)).run();

  switch (event) {
    case "email-bounced":
      setLead("bounced");
      return;
    case "prospect-unsubscribed":
      setLead("unsubscribed");
      return;
    case "email-account-disconnected":
    case "email-account-paused":
    case "sequence-paused": {
      const what = event === "sequence-paused" ? "A Saleshandy sequence was paused" : "Your Saleshandy mailbox needs attention";
      const detail = findField(payload, /^(reason|message|title|sequenceName|sequence_name|email)$/i) ?? "";
      await notifyAll({ title: what, body: `${detail} Open Saleshandy to check.`.trim().slice(0, 180), url: "/outreach" }).catch(() => {});
      return;
    }
    case "reply-received":
      break;
    default:
      return;
  }

  const raw = findField(payload, /^(replyContent|reply_content|replyBody|reply_body|content|body|emailBody|email_body|text|message|snippet)$/i) ?? "";
  const reply = newPart(stripHtml(raw));
  if (!reply) return;
  const threadId = findField(payload, /^(conversationId|conversation_id|emailThreadId|threadId|thread_id)$/i);
  const emailId = findField(payload, /^(emailId|email_id|replyEmailId|messageId)$/i);
  if (lead) db().insert(schema.outreachMessages).values({ leadId: lead.id, direction: "in", kind: "reply_in", body: reply }).run();

  const kind = await classify(reply);
  const who = `${name}${company ? ` (${company})` : ""}`;
  switch (kind) {
    case "auto_reply":
    case "bounce":
      return;
    case "unsubscribe":
      setLead("unsubscribed");
      return;
    case "no":
      setLead("not_interested");
      return;
    case "yes":
    case "question": {
      setLead(kind === "yes" ? "interested" : "needs_review");
      const auditStarted = kind === "yes" && lead ? startAudit(lead, reply) : false;
      const draft = await draftAnswer(name, company || "their business", lead?.notes ?? null, reply, kind === "yes").catch(() => "");
      if (draft && threadId && email) {
        createApproval({
          what: `Reply to ${who}: "${reply.slice(0, 200)}${reply.length > 200 ? "…" : ""}"\n\nDraft answer:\n${draft}`,
          why:
            kind === "yes"
              ? `They said yes to the free audit.${auditStarted ? " The Audit Desk has started on it." : ""} Approve to send this reply from Saleshandy.`
              : "They asked something that needs a real answer. Jarvis researched it and drafted this. Approve to send it from Saleshandy.",
          action: { type: "saleshandy_reply", threadId, emailId, to: email, body: draft, leadId: lead?.id },
        });
      }
      await notifyAll({
        title: kind === "yes" ? `🔥 ${company || name} wants the audit` : `${company || name} asked a question`,
        body: reply.slice(0, 160),
        url: "/",
      }).catch(() => {});
      return;
    }
  }
}
