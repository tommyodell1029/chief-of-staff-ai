// Saleshandy (open-api.saleshandy.com): finds a company's decision-maker with Lead Finder, reveals their verified
// work email, and adds leads to a Saleshandy sequence (Saleshandy then does the sending and follow-ups).
// SALESHANDY_API_KEY from Saleshandy → Settings → API Key. Reveals use Lead Finder credits (about 1 per email),
// capped by SALESHANDY_DAILY_REVEALS (default 30 a day).
import { getSetting, setSetting } from "@/lib/settings";

const API = "https://open-api.saleshandy.com/v1";

export const saleshandyConfigured = () => !!process.env.SALESHANDY_API_KEY;

async function sh<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
  const res = await fetch(`${API}${path}${qs}`, {
    method: init.method ?? "GET",
    headers: { "x-api-key": process.env.SALESHANDY_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { payload?: T; message?: string; error?: boolean };
  if (!res.ok || data.error) {
    if (res.status === 401 || res.status === 403) throw new Error("Saleshandy: the API key was refused. Check SALESHANDY_API_KEY in Render.");
    throw new Error(`Saleshandy: ${data.message ?? `HTTP ${res.status}`}`);
  }
  return data.payload as T;
}

// ---------- Credits ----------

const revealKey = () => `saleshandy_reveals:${new Date().toISOString().slice(0, 10)}`;
const dailyReveals = () => Number(process.env.SALESHANDY_DAILY_REVEALS || 30);
export const revealsToday = () => Number(getSetting(revealKey()) ?? 0);

export async function saleshandyCredits() {
  return sh<{ totalCredits: number; creditConsumedToday: number; creditConsumedThisMonth: number }>("/credits");
}

// ---------- Finding the decision-maker ----------

interface ShPerson {
  id: number;
  full_name: string;
  job_title: string;
  company_name: string;
  company_website: string;
  decision_maker: boolean;
}

const RANK = ["owner", "founder", "president", "ceo", "principal", "general manager", "partner", "operations", "office manager"];
const rank = (p: ShPerson) => {
  const t = (p.job_title ?? "").toLowerCase();
  const i = RANK.findIndex((r) => t.includes(r));
  return (i === -1 ? RANK.length : i) - (p.decision_maker ? 0.5 : 0);
};

async function searchPeople(domain: string): Promise<ShPerson[]> {
  const payload = await sh<{ people?: ShPerson[] } | []>("/search/people", {
    method: "POST",
    body: { company_domain: { includes: [domain] }, page: 1 },
  });
  return Array.isArray(payload) ? [] : (payload.people ?? []);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC = /^(info|contact|hello|hi|sales|support|service|admin|office|team|help|billing|jobs|careers|marketing|noreply|no-reply|mail|enquiries|inquiries)@/i;

// The results format isn't fixed in Saleshandy's docs, so look for the work email (and its status) anywhere in the record.
export function pickEmail(rec: unknown): { email: string; status: string } | null {
  const found: { key: string; email: string; status?: string }[] = [];
  const walk = (v: unknown, key: string, parent?: Record<string, unknown>) => {
    if (typeof v === "string" && EMAIL.test(v.trim())) {
      const statusEntry = parent && Object.entries(parent).find(([k, s]) => /status|verif/i.test(k) && typeof s === "string");
      found.push({ key, email: v.trim().toLowerCase(), status: statusEntry?.[1] as string | undefined });
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key, parent));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${key}.${k}`, v as Record<string, unknown>);
  };
  walk(rec, "");
  const score = (f: { key: string }) => (/personal/i.test(f.key) ? 2 : /work|business|email/i.test(f.key) ? 0 : 1);
  const best = found.filter((f) => !GENERIC.test(f.email)).sort((a, b) => score(a) - score(b))[0];
  if (!best) return null;
  const s = (best.status ?? "valid").toLowerCase();
  const status = /invalid|undeliverable|bounce/.test(s) ? "invalid" : /catch|accept|risky/.test(s) ? "accept_all" : /unknown|unverified/.test(s) ? "unknown" : "valid";
  return { email: best.email, status };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function revealEmail(leadId: number): Promise<{ email: string; status: string } | null> {
  if (revealsToday() >= dailyReveals()) throw new Error(`Saleshandy daily email limit reached (${dailyReveals()}).`);
  setSetting(revealKey(), String(revealsToday() + 1));
  const job = await sh<{ requestId: string }>("/enrich/contact", { method: "POST", body: { lead_id: [leadId], email_type: "work_email", reveal_phone: false } });
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const st = await sh<{ status: string }>(`/enrich/status/${job.requestId}`);
    if (st.status === "failed") return null;
    if (st.status === "completed") break;
  }
  const out = await sh<{ status: string; results?: unknown[] }>(`/enrich/status/result/${job.requestId}`);
  for (const r of out.results ?? []) {
    const e = pickEmail(r);
    if (e) return e;
  }
  return null;
}

export interface ShContact {
  name: string | null;
  title: string | null;
  email: string;
  status: string;
}

// The owner (or nearest decision-maker) at a company and their verified work email.
export async function saleshandyDecisionMaker(domain: string): Promise<{ contact: ShContact | null; note: string }> {
  const people = (await searchPeople(domain)).sort((a, b) => rank(a) - rank(b));
  if (!people.length) return { contact: null, note: "Saleshandy found no one at this company" };
  for (const p of people.slice(0, 2)) {
    const e = await revealEmail(p.id);
    if (e && e.status !== "invalid") return { contact: { name: p.full_name || null, title: p.job_title || null, email: e.email, status: e.status }, note: "" };
  }
  return { contact: null, note: "Saleshandy found people but no usable email" };
}

// ---------- Sequences ----------

export interface ShSequence {
  id: string;
  title: string;
  active: boolean;
  steps: { id: string; name: string }[];
}

export async function listSequences(): Promise<ShSequence[]> {
  const s = await sh<ShSequence[]>("/sequences");
  return Array.isArray(s) ? s : [];
}

let fieldLabels: { at: number; labels: Set<string> } | null = null;
async function availableFields(): Promise<Set<string>> {
  if (fieldLabels && Date.now() - fieldLabels.at < 3_600_000) return fieldLabels.labels;
  const f = await sh<{ label: string }[]>("/fields", { query: { systemFields: "true" } }).catch(() => []);
  fieldLabels = { at: Date.now(), labels: new Set((Array.isArray(f) ? f : []).map((x) => x.label)) };
  return fieldLabels.labels;
}

export interface ShProspect {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  category?: string | null; // custom field "Category", e.g. "dentist"
  personalLine?: string | null; // custom field "Personal Line": one true opening sentence about this business
}

// Adds prospects to the first step of a sequence. Saleshandy re-verifies each email and skips people
// who already unsubscribed or bounced. Only called for campaigns Tommy approved.
export async function addToSequence(stepId: string, prospects: ShProspect[], tags: string[]) {
  if (!prospects.length) return null;
  const have = await availableFields();
  const put = (row: Record<string, string>, label: string, value?: string | null) => {
    if (value && (have.size === 0 ? ["First Name", "Last Name", "Email", "Company", "Job Title"].includes(label) : have.has(label))) row[label] = value;
  };
  const prospectList = prospects.map((p) => {
    const row: Record<string, string> = { Email: p.email };
    put(row, "First Name", p.firstName);
    put(row, "Last Name", p.lastName);
    put(row, "Company", p.company);
    put(row, "Job Title", p.jobTitle);
    put(row, "Phone Number", p.phone);
    put(row, "Website", p.website);
    put(row, "City", p.city);
    put(row, "Category", p.category);
    put(row, "Personal Line", p.personalLine);
    return row;
  });
  return sh<{ requestId: string }>("/sequences/prospects/import-with-field-name", {
    method: "POST",
    body: { prospectList, stepId, verifyProspects: true, conflictAction: "noUpdate", tags },
  });
}

// ---------- Replies (webhook in, approved answers out) ----------

export const WEBHOOK_EVENTS = [
  "reply-received",
  "email-bounced",
  "prospect-unsubscribed",
  "email-account-disconnected",
  "email-account-paused",
  "sequence-paused",
];

// Registers (once) a Saleshandy webhook that tells Jarvis about replies and problems as they happen.
// The secret travels in a custom header, so only Saleshandy's deliveries are accepted.
export async function connectWebhook(url: string, secret: string): Promise<string> {
  const existing = await sh<{ id?: string; webhookUrl?: string; url?: string }[] | { webhooks?: { id?: string; webhookUrl?: string }[] }>("/webhook").catch(() => []);
  const list = Array.isArray(existing) ? existing : (existing.webhooks ?? []);
  const same = list.find((w) => (w.webhookUrl ?? (w as { url?: string }).url) === url);
  if (same) return "already connected";
  await sh("/webhook/create", { method: "POST", body: { name: "Jarvis", webhookUrl: url, webhookEvent: WEBHOOK_EVENTS, headers: { "x-jarvis-token": secret } } });
  return "connected";
}

const firstString = (o: unknown, keys: RegExp): string | null => {
  let out: string | null = null;
  const walk = (v: unknown, k: string) => {
    if (out) return;
    if (typeof v === "string" && keys.test(k) && v.trim()) out = v.trim();
    else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v as Record<string, unknown>)) walk(x, kk);
  };
  walk(o, "");
  return out;
};

// Sends Tommy's approved answer from the same Saleshandy mailbox and thread.
export async function replyInSaleshandy(threadId: string, emailId: string | null, to: string, text: string): Promise<void> {
  let id = emailId;
  if (!id) {
    // Find the newest email in the thread to reply to.
    const thread = await sh<unknown>(`/unified-inbox/emails/${encodeURIComponent(threadId)}`);
    const emails = (thread as { emails?: unknown[] })?.emails ?? (Array.isArray(thread) ? thread : []);
    const last = emails[emails.length - 1];
    id = firstString(last, /^(id|emailId|hashId)$/i);
  }
  if (!id) throw new Error("Couldn't find the email to reply to.");
  const html = text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
    .join("");
  await sh("/unified-inbox/emails/reply", { method: "POST", body: { emailThreadId: threadId, emailId: id, content: html, to: [to] } });
}

export { firstString as findField };
