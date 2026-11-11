// Boost candidates: every Sunday evening, the Etsy posts (labeled "Ad") from the last three weeks that people
// engaged with most, as a suggestion to promote them with Instagram's Boost. Jarvis never spends on ads: Tommy
// boosts in the Instagram app himself if he agrees.
import { instagramConfigured, recentPosts, type IgPost } from "@/lib/integrations/instagram";
import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";

const isAd = (caption: string) => /^(#?ad\b|ad\s*[:·|-])/i.test(caption.trim());
// Saves and shares say "I want this" more than a like does.
export const score = (p: IgPost) => p.likes + 3 * p.comments + 4 * (p.saves ?? 0) + 5 * (p.shares ?? 0);

export function pickCandidates(posts: IgPost[], now = Date.now()): IgPost[] {
  const recent = posts.filter((p) => now - new Date(p.timestamp).getTime() <= 21 * 86_400_000);
  const all = recent.map(score).sort((a, b) => a - b);
  const median = all.length ? all[Math.floor(all.length / 2)] : 0;
  return recent
    .filter((p) => isAd(p.caption) && score(p) > median && score(p) >= 10)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 2);
}

// Without Meta's API: the posts Tommy marked posted in Nina Studio, with the results he typed in.
export function manualPosts(): IgPost[] {
  const since = new Date(Date.now() - 21 * 86_400_000);
  return getDb()
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "posted"), gte(schema.contentItems.postedAt, since)))
    .all()
    .filter((p) => p.likes !== null || p.comments !== null || p.saves !== null)
    .map((p) => ({
      id: String(p.id),
      caption: p.caption,
      timestamp: (p.postedAt ?? p.createdAt).toISOString(),
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      saves: p.saves,
      shares: null,
      permalink: `Nina Studio post #${p.id}`,
      type: p.videoFile ? "REEL" : "IMAGE",
    }));
}

// Etsy posts marked posted in the last 3 weeks that still have no results typed in.
function postsMissingResults() {
  const since = new Date(Date.now() - 21 * 86_400_000);
  return getDb()
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "posted"), gte(schema.contentItems.postedAt, since)))
    .all()
    .filter((p) => isAd(p.caption) && p.likes === null && p.comments === null && p.saves === null);
}

export async function weeklyBoostCandidates(force = false): Promise<string> {
  const week = new Date().toISOString().slice(0, 10);
  if (!force && getSetting("boost:last") === week) return "Already suggested this week.";
  const posts = instagramConfigured() ? await recentPosts(40) : manualPosts();
  const picks = pickCandidates(posts);
  setSetting("boost:last", week);
  if (!picks.length) {
    const missing = instagramConfigured() ? [] : postsMissingResults();
    if (missing.length) {
      const { notifyAll } = await import("@/lib/push");
      await notifyAll({
        title: "Nina's results for boost picks",
        body: `${missing.length} Etsy post${missing.length === 1 ? " is" : "s are"} missing likes/comments/saves. Add them under Nina Studio → Posted, then ask me for boost picks.`,
        url: "/studio",
        station: false,
      }).catch(() => {});
      setSetting("boost:last", ""); // try again once the results are in
      return `Asked Tommy for results on ${missing.length} Etsy post${missing.length === 1 ? "" : "s"}.`;
    }
    return "No Etsy post stood out this week (each needs above-average engagement and at least a little traction).";
  }
  const { createApproval, findAgent } = await import("@/lib/crews/crews");
  const agent = findAgent("Nina", "Growth Analyst").agent;
  const lines = picks.map(
    (p) =>
      `• ${p.caption.split("\n")[0].slice(0, 90)}\n  ${p.likes} likes, ${p.comments} comments${p.saves !== null ? `, ${p.saves} saves` : ""}${p.shares !== null ? `, ${p.shares} shares` : ""} · ${p.permalink}`,
  );
  createApproval({
    what: `Boost candidates this week (Nina's Etsy posts that did best):\n${lines.join("\n")}`,
    why: "Suggested test: boost each one for $5 a day for 3 days ($15 each), aimed at people like her followers, and compare bio-link clicks to Etsy. Approve if you'll do it: the Growth Analyst then writes the exact Boost settings. Jarvis doesn't spend on ads himself.",
    agentId: agent?.id,
  });
  return `Suggested ${picks.length} post${picks.length === 1 ? "" : "s"} to boost.`;
}
