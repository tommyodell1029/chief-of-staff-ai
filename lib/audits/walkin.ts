// Walk-in audit: the free 5-point Google Maps check for any business, by name, printed as a one-page leave-behind
// that Tommy hands to the owner in person. Facts come straight from Google Maps (Places API, counted against the
// daily cap); the AI-search check uses a quick web search. Nothing here is a guarantee: it reports what we found.
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODELS } from "@/config/models";
import { runJob, webSearch } from "@/lib/ai";
import { findInResults } from "@/lib/clients/clients";
import { getDb, schema } from "@/lib/db";
import type { Audit } from "@/lib/db/schema";
import { searchMaps, type MapsPlace } from "@/lib/integrations/places";

export type Status = "good" | "fix" | "unknown";

export interface AuditData {
  business: string;
  city: string;
  searches: { search: string; rank: number | null; top: { name: string; rating: number | null; reviews: number }[] }[];
  listing: { found: boolean; name?: string; address?: string; phone?: string | null; website?: string | null; category?: string | null; rating?: number | null; reviews?: number; newestReviewDays?: number | null; hours?: boolean; photos?: number; mapsUrl?: string | null };
  points: { title: string; status: Status; lines: string[] }[];
  fixes: string[];
  plan: "visibility" | "mappack";
  ai: { checked: boolean; mentioned: boolean; who: string[] };
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

// Asks a web search what a customer would see for "best <search> in <city>": is this business recommended?
async function aiSearchCheck(business: string, search: string, city: string): Promise<AuditData["ai"]> {
  let result: AuditData["ai"] = { checked: false, mentioned: false, who: [] };
  const record = betaZodTool({
    name: "record",
    description: "Record what the search showed.",
    inputSchema: z.object({ mentioned: z.boolean(), recommended_businesses: z.array(z.string()).max(5) }),
    run: async (r) => {
      result = { checked: true, mentioned: r.mentioned, who: r.recommended_businesses };
      return "ok";
    },
  });
  try {
    await runJob({
      purpose: "walkin_ai_check",
      model: MODELS.worker,
      system: "You check whether a local business shows up when someone asks an AI assistant for a recommendation. Search the web once, the way a customer would, then call record exactly once.",
      prompt: `Search: "best ${search} in ${city}". Is "${business}" named or recommended in what you find? List up to 5 businesses that are recommended.`,
      tools: [webSearch(MODELS.worker.id, 1), record],
      maxIterations: 3,
      maxTokens: 800,
    });
  } catch {
    // No AI available: this point is reported as not checked.
  }
  return result;
}

export async function runWalkinAudit(input: { business: string; city: string; searches: string[]; website?: string }): Promise<Audit> {
  const business = input.business.trim();
  const city = input.city.trim() || "Jacksonville, FL";
  const searches = input.searches.map((s) => s.trim()).filter(Boolean).slice(0, 2);
  if (!business || !searches.length) throw new Error("Need the business name and at least one search, e.g. 'plumber'.");

  const results: AuditData["searches"] = [];
  let me: MapsPlace | undefined;
  for (const s of searches) {
    const places = await searchMaps(`${s} in ${city}`, 20);
    const hit = findInResults({ name: business, website: input.website ?? null }, places);
    me ??= hit;
    results.push({ search: s, rank: hit?.rank ?? null, top: places.slice(0, 3).map((p) => ({ name: p.name, rating: p.rating, reviews: p.reviewCount })) });
  }
  if (!me) {
    // Not in the top 20 for their searches: look up their own listing by name.
    const own = await searchMaps(`${business} ${city}`, 3);
    me = findInResults({ name: business, website: input.website ?? null }, own) ?? own[0];
  }
  const ai = await aiSearchCheck(business, searches[0], city);

  const listing: AuditData["listing"] = me
    ? { found: true, name: me.name, address: me.address, phone: me.phone, website: me.website, category: me.category, rating: me.rating, reviews: me.reviewCount, newestReviewDays: me.latestReviewDaysAgo, hours: me.hoursListed, photos: me.photoCount, mapsUrl: me.mapsUrl }
    : { found: false };

  // 1. Where they show up
  const best = results.map((r) => r.rank).filter((r): r is number => r !== null).sort((a, b) => a - b)[0] ?? null;
  const p1: AuditData["points"][0] = {
    title: "Where you show up on Google Maps",
    status: best !== null && best <= 3 ? "good" : "fix",
    lines: results.map((r) => `"${r.search}": ${r.rank ? `#${r.rank}${r.rank <= 3 ? " (in the top 3 that get most of the calls)" : ""}` : "not in the top 20"}`),
  };
  // 2. Profile completeness
  const profileIssues: string[] = [];
  if (listing.found) {
    if (!listing.hours) profileIssues.push("No business hours listed");
    if ((listing.photos ?? 0) < 10) profileIssues.push(`Only ${listing.photos} photo${listing.photos === 1 ? "" : "s"} (top businesses show 10+)`);
    if (!listing.website) profileIssues.push("No website linked");
  }
  const p2: AuditData["points"][0] = {
    title: "Profile completeness",
    status: !listing.found ? "fix" : profileIssues.length ? "fix" : "good",
    lines: !listing.found
      ? ["We couldn't find your Google Business Profile. Customers may not be able to either."]
      : profileIssues.length
        ? profileIssues
        : [`Hours, photos and website are all there${listing.category ? ` (listed as "${listing.category}")` : ""}.`],
  };
  // 3. Reviews
  const topReviews = avg((results[0]?.top ?? []).filter((t) => t.name !== listing.name).map((t) => t.reviews)); // the main search's top 3
  const reviewLines: string[] = [];
  let reviewStatus: Status = "good";
  if (listing.found) {
    reviewLines.push(`${listing.rating ?? "No"}★ from ${listing.reviews} review${listing.reviews === 1 ? "" : "s"}${topReviews ? ` (the top 3 average about ${topReviews})` : ""}`);
    if (topReviews && (listing.reviews ?? 0) < topReviews * 0.6) reviewStatus = "fix";
    if (listing.newestReviewDays !== null && listing.newestReviewDays !== undefined) {
      reviewLines.push(`Newest review: ${listing.newestReviewDays === 0 ? "today" : `${listing.newestReviewDays} days ago`}`);
      if (listing.newestReviewDays > 45) reviewStatus = "fix";
    }
    if ((listing.rating ?? 5) < 4.3) reviewStatus = "fix";
  } else {
    reviewStatus = "fix";
    reviewLines.push("No reviews found on Google.");
  }
  const p3: AuditData["points"][0] = { title: "Reviews", status: reviewStatus, lines: reviewLines };
  // 4. Name, address, phone
  const p4: AuditData["points"][0] = {
    title: "Name, address & phone across the web",
    status: "unknown",
    lines: listing.found
      ? [`Google shows: ${listing.name} · ${listing.address}${listing.phone ? ` · ${listing.phone}` : ""}`, "These should match exactly on Yelp, Facebook, Apple Maps and BBB. We check all of them in the full audit."]
      : ["We check Google, Yelp, Facebook, Apple Maps and BBB in the full audit."],
  };
  // 5. AI search
  const p5: AuditData["points"][0] = {
    title: "AI search (ChatGPT, Google AI answers)",
    status: !ai.checked ? "unknown" : ai.mentioned ? "good" : "fix",
    lines: !ai.checked
      ? ["Not checked this time."]
      : ai.mentioned
        ? [`When we asked for the best ${searches[0]} in ${city}, you were mentioned.`]
        : [`When we asked for the best ${searches[0]} in ${city}, you weren't mentioned${ai.who.length ? `. It suggested: ${ai.who.slice(0, 3).join(", ")}` : ""}.`],
  };

  // The fixes that matter most, in order.
  const fixes: string[] = [];
  if (!listing.found) fixes.push("Claim and complete your Google Business Profile so customers can find you on the map.");
  if (p1.status === "fix") fixes.push(`Climb into the top 3 for "${searches[0]}": that's where most calls go.`);
  if (reviewStatus === "fix") fixes.push("Get a steady flow of new reviews from happy customers (and reply to every one).");
  if (profileIssues.some((x) => x.startsWith("No business hours"))) fixes.push("Add your hours: Google favors complete profiles.");
  if (profileIssues.some((x) => x.startsWith("Only"))) fixes.push("Add fresh photos of your work every week.");
  if (p5.status === "fix") fixes.push("Give AI search clear facts about you (services, area, FAQs) so it recommends you.");
  if (!fixes.length) fixes.push("You're in good shape. Keep posts, photos and reviews coming every week to stay on top.");
  const plan: AuditData["plan"] = p1.status === "fix" || reviewStatus === "fix" ? "mappack" : "visibility";

  const data: AuditData = { business, city, searches: results, listing, points: [p1, p2, p3, p4, p5], fixes: fixes.slice(0, 3), plan, ai };
  return getDb().insert(schema.audits).values({ business, city, data: JSON.stringify(data), createdAt: new Date() }).returning().get();
}

export function getAudit(id: number): (Audit & { parsed: AuditData }) | undefined {
  const a = getDb().select().from(schema.audits).where(eq(schema.audits.id, id)).get();
  return a ? { ...a, parsed: JSON.parse(a.data) as AuditData } : undefined;
}

export function listAudits(limit = 30) {
  return getDb()
    .select()
    .from(schema.audits)
    .orderBy(desc(schema.audits.createdAt))
    .limit(limit)
    .all()
    .map((a) => {
      const d = JSON.parse(a.data) as AuditData;
      return { id: a.id, business: a.business, city: a.city, createdAt: a.createdAt, fixes: d.points.filter((p) => p.status === "fix").length, plan: d.plan };
    });
}
