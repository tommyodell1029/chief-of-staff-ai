// Free audit requests from yourbusiness.com. The site's form opens the visitor's email app with a ready email
// ("Free audit request: <business>") to you@yourbusiness.com. Every 10 minutes Jarvis looks for new ones in
// Gmail, hands each to LaunchPad Local's Audit Desk (which drafts the audit for Tommy to approve), and tells Tommy.
// Nothing is sent to the business until Tommy approves the draft.
import { AGENCY_NAME } from "@/config/business";
import { createTask, findAgent } from "@/lib/crews/crews";
import { gmailConnected, gmailRead, gmailSearch } from "@/lib/integrations/gmail";
import { notifyAll } from "@/lib/push";
import { getSetting, setSetting } from "@/lib/settings";

export interface AuditRequest {
  business: string;
  name: string;
  trade: string;
  email: string;
  link: string;
  interest: string;
  from: string;
}

// Reads the lines the website's form writes ("Business: …", "Name: …", …).
export function parseAuditRequest(subject: string, body: string, from: string): AuditRequest {
  const line = (label: string) => body.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
  const fromEmail = from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "";
  return {
    business: line("Business") || subject.replace(/^.*Free audit request:\s*/i, "").trim(),
    name: line("Name"),
    trade: line("What we do"),
    email: line("Email for the report") || fromEmail,
    link: line("Website or Google listing"),
    interest: line("Interested in"),
    from: fromEmail,
  };
}

// Starts the Audit Desk on a request (from the website form or its email fallback) and tells Tommy.
// The same business + email within a day is treated as one request (e.g. sent by both routes).
export async function startAuditRequest(r: AuditRequest, source: "website" | "email"): Promise<"started" | "duplicate" | "crew_not_ready"> {
  const dupKey = `audit_dup:${(r.email + "|" + r.business).toLowerCase().replace(/\s+/g, " ").trim()}`;
  const seen = Number(getSetting(dupKey) ?? 0);
  if (seen && Date.now() - seen < 86_400_000) return "duplicate";
  setSetting(dupKey, String(Date.now()));
  const { agent } = findAgent(AGENCY_NAME, "Audit Desk");
  const who = `${r.business}${r.name ? ` (${r.name})` : ""}`;
  if (!agent || agent.status !== "active") {
    await notifyAll({ title: `📝 Audit request: ${r.business}`, body: `${who} asked for the free audit (${r.email}), but the LaunchPad Local crew isn't approved yet, so nothing was started. Approve the crew, then ask Jarvis to do the audit.`, url: "/" }).catch(() => {});
    return "crew_not_ready";
  }
  createTask(
    agent.id,
    `New free 5-point audit request from the yourbusiness.com form${source === "email" ? " (by email)" : ""}.
Business: ${r.business}
Contact: ${r.name || "not given"}
What they do: ${r.trade || "not given"}
Website or Google listing: ${r.link || "not given; find their Google listing with maps_search"}
Interested in: ${r.interest || "not said"}
Send the audit to: ${r.email}

Research their Google listing and website, write the 5-point audit, and save it with email_draft addressed to ${r.email} (subject like "Your free 5-point audit: ${r.business}"). Tommy approves before it's sent.`,
    "schedule",
  );
  await notifyAll({ title: `📝 Audit request: ${r.business}`, body: `${who} asked for the free audit. The Audit Desk is on it; you'll approve the draft.`, url: "/", say: `Sir, ${r.business} just asked for a free audit. The Audit Desk is on it.` }).catch(() => {});
  return "started";
}

export async function checkAuditRequests() {
  if (!gmailConnected()) return;
  const found = await gmailSearch('subject:"Free audit request" newer_than:7d', 10);
  for (const m of found) {
    const key = `audit_request:${m.id}`;
    if (getSetting(key)) continue;
    setSetting(key, "1"); // marked first, so a failure below can't start the same audit twice
    const msg = await gmailRead(m.id);
    await startAuditRequest(parseAuditRequest(msg.subject, msg.body, msg.from), "email");
  }
}
