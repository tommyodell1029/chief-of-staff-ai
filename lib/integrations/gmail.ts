// Tommy's one Google sign-in (Workspace, "internal" app): Gmail (read, search, drafts; send only after approval),
// Google Calendar (read-only) and Google Drive (only files Jarvis creates).
// Setup: docs/connections-setup.md → GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, then "Connect Google" in Jarvis.
import { publicBaseUrl } from "@/lib/publicUrl";
import { getSetting, setSetting } from "@/lib/settings";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose", // create drafts, and send (only via an approval or an approved campaign)
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.file", // only files and folders Jarvis creates himself
];
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export function googleAppConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function gmailConnected(): boolean {
  return googleAppConfigured() && !!getSetting("google_refresh_token");
}

export function gmailAccount(): string | undefined {
  return getSetting("google_email");
}

// The address Google sends Tommy back to. It must match the redirect URI saved in Google Cloud exactly.
export function googleRedirectUri(req: Request): string {
  return `${publicBaseUrl(req)}/api/google/callback`;
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

let access: { token: string; expires: number } | null = null;

export async function finishGoogleConnect(code: string, redirectUri: string) {
  const t = (await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri })) as Awaited<ReturnType<typeof tokenRequest>> & { scope?: string };
  setSetting("google_scopes", t.scope ?? "");
  if (!t.refresh_token) throw new Error("Google didn't return a long-term token. Remove Jarvis's access in your Google account and connect again.");
  setSetting("google_refresh_token", t.refresh_token);
  access = { token: t.access_token!, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 };
  const profile = await gmail<{ emailAddress: string }>("/profile");
  setSetting("google_email", profile.emailAddress);
  return profile.emailAddress;
}

export function disconnectGoogle() {
  getDb().delete(schema.settings).where(eq(schema.settings.key, "google_refresh_token")).run();
  getDb().delete(schema.settings).where(eq(schema.settings.key, "google_email")).run();
  getDb().delete(schema.settings).where(eq(schema.settings.key, "google_scopes")).run();
  access = null;
}

export function googleScopes(): string {
  return getSetting("google_scopes") ?? "";
}

export async function accessToken(): Promise<string> {
  if (access && Date.now() < access.expires) return access.token;
  const refresh = getSetting("google_refresh_token");
  if (!refresh) throw new Error("Google isn't connected. Tap Connections → Connect Google.");
  const t = await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" });
  access = { token: t.access_token!, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 };
  return access.token;
}

async function gmail<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init?.json ? { "Content-Type": "application/json" } : {}) },
    body: init?.json ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Gmail: ${data.error?.message ?? res.status}`);
  return data;
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  payload: { headers?: { name: string; value: string }[]; mimeType: string; body?: { data?: string }; parts?: GmailMessage["payload"][] };
}

const header = (m: GmailMessage, name: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

// Search with Gmail's own query syntax, e.g. "is:unread newer_than:1d" or "from:stripe.com".
export async function gmailSearch(query: string, max = 10) {
  const list = await gmail<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(max, 25)}`);
  const out = [];
  for (const { id } of list.messages ?? []) {
    const m = await gmail<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push({
      id,
      from: header(m, "From"),
      subject: header(m, "Subject"),
      date: header(m, "Date"),
      unread: m.labelIds?.includes("UNREAD") ?? false,
      snippet: m.snippet,
    });
  }
  return out;
}

function plainText(part: GmailMessage["payload"]): string {
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const t = plainText(p);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }
  return "";
}

export async function gmailRead(id: string) {
  const m = await gmail<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  return {
    from: header(m, "From"),
    to: header(m, "To"),
    subject: header(m, "Subject"),
    date: header(m, "Date"),
    body: plainText(m.payload).slice(0, 8000),
  };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

// Saves an email as a draft in Tommy's Gmail. Creating a draft never sends anything.
export async function createDraft(to: string, subject: string, body: string): Promise<{ id: string }> {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(oneLine(subject)).toString("base64")}?=`;
  const raw = [
    `To: ${oneLine(to)}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  const draft = await gmail<{ id: string }>("/drafts", { method: "POST", json: { message: { raw: Buffer.from(raw).toString("base64url") } } });
  return { id: draft.id };
}

// Sends a draft. Only called after Tommy approves.
export async function sendDraft(draftId: string): Promise<string> {
  const sent = await gmail<{ id: string }>("/drafts/send", { method: "POST", json: { id: draftId } });
  return sent.id;
}

// ---------- Outreach: sending in threads and reading replies ----------

function rawEmail(h: { to: string; subject: string; inReplyTo?: string; references?: string }, body: string) {
  const lines = [
    `To: ${oneLine(h.to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(oneLine(h.subject)).toString("base64")}?=`,
    ...(h.inReplyTo ? [`In-Reply-To: ${oneLine(h.inReplyTo)}`, `References: ${oneLine(h.references ?? h.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// Sends right away (used only by approved campaigns and approved replies).
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  thread?: { threadId: string; inReplyTo?: string; references?: string },
): Promise<{ id: string; threadId: string }> {
  return gmail<{ id: string; threadId: string }>("/messages/send", {
    method: "POST",
    json: { raw: rawEmail({ to, subject, inReplyTo: thread?.inReplyTo, references: thread?.references }, body), ...(thread ? { threadId: thread.threadId } : {}) },
  });
}

// A draft that replies inside an existing thread.
export async function createReplyDraft(
  to: string,
  subject: string,
  body: string,
  thread: { threadId: string; inReplyTo?: string; references?: string },
): Promise<{ id: string }> {
  return gmail<{ id: string }>("/drafts", {
    method: "POST",
    json: { message: { threadId: thread.threadId, raw: rawEmail({ to, subject, inReplyTo: thread.inReplyTo, references: thread.references }, body) } },
  });
}

export interface ThreadMessage {
  id: string;
  from: string;
  subject: string;
  messageId: string; // the Message-ID header, for threading replies
  references: string;
  date: number;
  body: string;
}

export async function getThread(threadId: string): Promise<ThreadMessage[]> {
  const t = await gmail<{ messages?: (GmailMessage & { internalDate?: string })[] }>(`/threads/${encodeURIComponent(threadId)}?format=full`);
  return (t.messages ?? []).map((m) => ({
    id: m.id,
    from: header(m, "From"),
    subject: header(m, "Subject"),
    messageId: header(m, "Message-ID") || header(m, "Message-Id"),
    references: header(m, "References"),
    date: Number(m.internalDate ?? 0),
    body: stripQuoted(plainText(m.payload)).slice(0, 6000),
  }));
}

// Drops the quoted earlier conversation ("On Tue, … wrote:") so only the new reply is analyzed.
function stripQuoted(text: string): string {
  const cut = text.search(/\n(On .+wrote:|-{2,}\s*Original Message|From: .+\n(Sent|Date):)/i);
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}

export function myAddress(): string {
  return (gmailAccount() ?? "").toLowerCase();
}
