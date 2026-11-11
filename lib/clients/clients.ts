// LaunchPad Local client delivery: the work promised on the $249 / $449 plans, run by Jarvis.
//   Weekly (Mon): a Google Maps check of each client's main searches (rank, rating, reviews, who's #1),
//                 and a Google Business Profile post drafted by the Client Success agent for Tommy to paste.
//   Monthly (1st): the one-page report, drafted in Gmail for Tommy's approval.
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { AGENCY_NAME } from "@/config/business";
import { getDb, schema } from "@/lib/db";
import type { Client } from "@/lib/db/schema";
import { mapsConfigured, searchMaps, type MapsPlace } from "@/lib/integrations/places";

const db = () => getDb();
export const PLANS: Record<string, { label: string; usd: number }> = {
  visibility: { label: "Local Visibility", usd: 249 },
  mappack: { label: "Map Pack Pro", usd: 449 },
};
const MAX_KEYWORDS = 3;

export function listClients(includeEnded = false): Client[] {
  const rows = db().select().from(schema.clients).orderBy(asc(schema.clients.name)).all();
  return includeEnded ? rows : rows.filter((c) => c.status !== "ended");
}

export function getClient(id: number) {
  return db().select().from(schema.clients).where(eq(schema.clients.id, id)).get();
}

export function keywordsOf(c: Client): string[] {
  try {
    return (JSON.parse(c.keywords) as string[]).slice(0, MAX_KEYWORDS);
  } catch {
    return [];
  }
}

export function addClient(c: { name: string; city: string; keywords: string[]; plan?: string; contactName?: string; email?: string; website?: string; notes?: string }): Client {
  return db()
    .insert(schema.clients)
    .values({
      name: c.name.trim(),
      city: c.city.trim(),
      keywords: JSON.stringify(c.keywords.map((k) => k.trim()).filter(Boolean).slice(0, MAX_KEYWORDS)),
      plan: c.plan === "mappack" ? "mappack" : "visibility",
      contactName: c.contactName?.trim() || null,
      email: c.email?.trim() || null,
      website: c.website?.trim() || null,
      notes: c.notes?.trim() || null,
    })
    .returning()
    .get();
}

export function updateClient(id: number, changes: Partial<Pick<Client, "name" | "city" | "plan" | "contactName" | "email" | "website" | "status" | "notes">> & { keywords?: string[] }) {
  const { keywords, ...rest } = changes;
  return db()
    .update(schema.clients)
    .set({ ...rest, ...(keywords ? { keywords: JSON.stringify(keywords.slice(0, MAX_KEYWORDS)) } : {}) })
    .where(eq(schema.clients.id, id))
    .returning()
    .get();
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const domainOf = (url?: string | null) => (url ? url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] : null);

// Finds the client in a list of Maps results: by website domain first, then by name.
export function findInResults(c: Pick<Client, "name" | "website">, places: MapsPlace[]): MapsPlace | undefined {
  const d = domainOf(c.website);
  if (d) {
    const byDomain = places.find((p) => p.domain === d);
    if (byDomain) return byDomain;
  }
  const n = norm(c.name);
  // Partial name matches only count for real names (a short competitor name like "B" must not match).
  return places.find((p) => norm(p.name) === n) ?? places.find((p) => (n.length >= 6 && norm(p.name).includes(n)) || (norm(p.name).length >= 6 && n.includes(norm(p.name))));
}

// The weekly Maps check for one client (one search per keyword).
export async function checkClient(c: Client): Promise<{ keyword: string; rank: number | null; leader: string | null }[]> {
  const out: { keyword: string; rank: number | null; leader: string | null }[] = [];
  for (const kw of keywordsOf(c)) {
    const places = await searchMaps(`${kw} in ${c.city}`, 20);
    const me = findInResults(c, places);
    const leader = places[0]?.name ?? null;
    db()
      .insert(schema.clientChecks)
      .values({ clientId: c.id, keyword: kw, rank: me?.rank ?? null, rating: me?.rating ?? null, reviewCount: me?.reviewCount ?? null, leader, createdAt: new Date() })
      .run();
    out.push({ keyword: kw, rank: me?.rank ?? null, leader });
  }
  return out;
}

export function checksFor(clientId: number, since?: Date) {
  return db()
    .select()
    .from(schema.clientChecks)
    .where(since ? and(eq(schema.clientChecks.clientId, clientId), gte(schema.clientChecks.createdAt, since)) : eq(schema.clientChecks.clientId, clientId))
    .orderBy(asc(schema.clientChecks.createdAt), asc(schema.clientChecks.id))
    .all();
}

// Latest check per keyword, plus the one from about a month before, for the report and the Clients page.
export function clientSnapshot(c: Client) {
  const all = checksFor(c.id);
  const monthAgo = Date.now() - 28 * 86_400_000;
  const kws = keywordsOf(c).map((kw) => {
    const rows = all.filter((r) => r.keyword === kw);
    const latest = rows[rows.length - 1];
    const before = [...rows].reverse().find((r) => r.createdAt.getTime() <= monthAgo) ?? rows[0];
    return { keyword: kw, latest, before: before && before !== latest ? before : undefined };
  });
  const latestAny = [...all].reverse().find((r) => r.rating !== null);
  const firstAny = all.find((r) => r.rating !== null);
  return { keywords: kws, rating: latestAny?.rating ?? null, reviews: latestAny?.reviewCount ?? null, reviewsAtStart: firstAny?.reviewCount ?? null, checks: all.length };
}

const place = (r: number | null | undefined) => (r ? `#${r}` : "not in the top 20");
const inPack = (r: number | null | undefined) => !!r && r <= 3;

// The one-page monthly report, in plain text (it goes out as an email Tommy approves).
export function monthlyReport(c: Client, month = new Date()): { subject: string; body: string } {
  const s = clientSnapshot(c);
  const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lines = s.keywords.map((k) => {
    const now = k.latest?.rank ?? null;
    const was = k.before?.rank ?? null;
    const move =
      !k.latest ? "first check coming this week" : was === null && now === null ? "still working on this one" : was === null ? `new: now ${place(now)}` : now === null ? `slipped out of the top 20 (was ${place(was)})` : now < was ? `up from ${place(was)} to ${place(now)}` : now > was ? `down from ${place(was)} to ${place(now)}` : `holding at ${place(now)}`;
    return `• "${k.keyword}": ${move}${inPack(now) ? " (in the top-3 map pack ✓)" : ""}`;
  });
  const newReviews = s.reviews !== null && s.reviewsAtStart !== null ? s.reviews - s.reviewsAtStart : null;
  const leaders = [...new Set(s.keywords.map((k) => k.latest?.leader).filter((x): x is string => !!x && norm(x) !== norm(c.name)))];
  const hi = c.contactName ? c.contactName.split(" ")[0] : "there";
  const body = [
    `Hi ${hi},`,
    "",
    `Here's your ${label} report from LaunchPad Local.`,
    "",
    "WHERE YOU SHOW UP ON GOOGLE MAPS",
    ...lines,
    "",
    "REVIEWS",
    s.rating !== null ? `• ${s.rating}★ from ${s.reviews} reviews${newReviews && newReviews > 0 ? ` (${newReviews} new since we started)` : ""}` : "• We'll have your review numbers after the first check.",
    "",
    "WHAT WE DID",
    "• Weekly Google posts and fresh photos on your profile",
    "• A reply to every new review",
    c.plan === "mappack" ? "• Review requests to recent customers, listing cleanup, and a competitor check" : "",
    "",
    leaders.length ? `WHO'S AHEAD OF YOU\n• ${leaders.slice(0, 2).join(" and ")} ${leaders.length === 1 ? "holds" : "hold"} the #1 spot right now. We're working to close the gap.` : "",
    "NEXT MONTH",
    "• Keep the weekly posts and review replies going",
    s.keywords.some((k) => !inPack(k.latest?.rank)) ? "• Push the searches that aren't in the top 3 yet" : "• Hold the top-3 spots and keep reviews coming",
    "",
    "Questions? Just reply to this email.",
  ]
    .filter((l) => l !== "")
    .join("\n")
    .replace(/\n(WHERE|REVIEWS|WHAT|WHO'S|NEXT|Questions)/g, "\n\n$1");
  return { subject: `${c.name}: your ${label} Google Maps report`, body };
}

// ---------- Scheduled work ----------

function clientSuccessAgent() {
  const biz = db().select().from(schema.businesses).where(eq(schema.businesses.name, AGENCY_NAME)).get();
  if (!biz) return undefined;
  return db()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.businessId, biz.id), eq(schema.agents.name, "Client Success")))
    .get();
}

// Monday: ranks for every client, then this week's Google post drafts.
export async function weeklyClientWork() {
  const active = listClients().filter((c) => c.status === "active");
  if (!active.length) return;
  const summary: string[] = [];
  if (mapsConfigured()) {
    for (const c of active) {
      try {
        const r = await checkClient(c);
        summary.push(`${c.name}: ${r.map((x) => `${x.keyword} ${place(x.rank)}`).join(", ")}`);
      } catch (err) {
        summary.push(`${c.name}: check failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  const agent = clientSuccessAgent();
  if (agent) {
    const { createTask } = await import("@/lib/crews/crews");
    for (const c of active) {
      const s = clientSnapshot(c);
      createTask(
        agent.id,
        `Weekly work for client ${c.name} (${PLANS[c.plan]?.label ?? c.plan}, ${c.city}). Their searches: ${keywordsOf(c).join(", ")}. Latest Maps ranks: ${s.keywords.map((k) => `${k.keyword} ${place(k.latest?.rank)}`).join("; ")}.
Draft this week's Google Business Profile post for them (under 1,500 characters, local and specific, one clear call to action, no prices or guarantees you can't back up), plus a suggested photo to add. Save it with save_note so Tommy can paste it into their profile.`,
        "schedule",
      );
    }
  }
  if (summary.length) {
    const { notifyAll } = await import("@/lib/push");
    await notifyAll({ title: "Client ranks checked", body: summary.join(" · ").slice(0, 230), url: "/clients", station: false }).catch(() => {});
  }
}

// 1st of the month: each active client's report as a Gmail draft, waiting for Tommy's OK.
export async function draftMonthlyReport(c: Client): Promise<string> {
  const { subject, body } = monthlyReport(c, new Date(Date.now() - 2 * 86_400_000)); // reports on the month just ended
  const { createApproval } = await import("@/lib/crews/crews");
  const { gmailConnected, createDraft } = await import("@/lib/integrations/gmail");
  const agent = clientSuccessAgent();
  if (c.email && gmailConnected()) {
    const { outreachSettings } = await import("@/lib/outreach/outreach");
    const sender = outreachSettings().senderName || "LaunchPad Local";
    const draft = await createDraft(c.email, subject, `${body}\n\n${sender}\nLaunchPad Local · yourbusiness.com`);
    const a = createApproval({
      what: `Send ${c.name}'s monthly report to ${c.email}\n\n${body}`,
      why: "The one-page monthly report from your plans. It's in your Gmail drafts too, if you want to edit it first.",
      agentId: agent?.id,
      action: { type: "gmail_send", draftId: draft.id, to: c.email, subject },
    });
    return `Report drafted; approval #${a.id}.`;
  }
  const a = createApproval({
    what: `${c.name}'s monthly report (copy and send it yourself${c.email ? "" : ": add their email on the Clients page so Jarvis can draft it in Gmail"})\n\n${body}`,
    why: "The one-page monthly report from your plans.",
    agentId: agent?.id,
  });
  return `Report ready; approval #${a.id}.`;
}

export async function monthlyClientReports() {
  for (const c of listClients().filter((x) => x.status === "active")) {
    await draftMonthlyReport(c).catch((err) => console.error("[clients] report failed", c.name, err));
  }
}

export function clientsText(): string {
  const list = listClients();
  if (!list.length) return "No LaunchPad Local clients yet.";
  return list
    .map((c) => {
      const s = clientSnapshot(c);
      return `${c.name} (${PLANS[c.plan]?.label ?? c.plan}, ${c.status}): ${s.keywords.map((k) => `${k.keyword} ${place(k.latest?.rank)}`).join("; ")}${s.rating !== null ? ` · ${s.rating}★ (${s.reviews})` : ""}`;
    })
    .join("\n");
}

export const latestChecks = (limit = 50) => db().select().from(schema.clientChecks).orderBy(desc(schema.clientChecks.createdAt)).limit(limit).all();
