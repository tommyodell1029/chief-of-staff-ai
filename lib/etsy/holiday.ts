// Christmas listing refresh. The Shop Marketer rewrites each live listing's title, 13 tags and opening lines for
// holiday shoppers ("Christmas gift for mom", "pet memorial ornament"…). Every change comes to Tommy as one approval
// showing before → after; approving updates only the words on Etsy. The originals are saved so "Undo holiday
// listings" in January puts them back.
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODELS } from "@/config/models";
import { runJob } from "@/lib/ai";
import { listLiveProducts, printifyConfigured, updateListingText } from "@/lib/integrations/printify";
import { getSetting, setSetting } from "@/lib/settings";

export const DEFAULT_CUTOFF = "December 10";
const MAX_LISTINGS = 12;

interface Original {
  title: string;
  description: string;
  tags: string[];
}

export interface Proposal {
  title: string;
  tags: string[];
  opening: string; // 1-2 sentences put at the top of the description
}

const backupKey = (id: string) => `holiday_backup:${id}`;

// Puts the holiday opening on top of the original description (replacing an earlier holiday opening, if any).
export function holidayDescription(original: string, opening: string, cutoff: string): string {
  const body = original.replace(/^🎄[^\n]*\n(?:[^\n]*\n)?\n?/, "");
  return `🎄 ${opening.trim()}\nOrder by ${cutoff} for Christmas delivery in the US (standard shipping).\n\n${body}`;
}

// Etsy tags: 13 at most, 20 characters each, letters/numbers/spaces only, no duplicates.
export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const c = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20).trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 13);
}

async function propose(p: { title: string; description: string; tags: string[] }): Promise<Proposal | null> {
  let out: Proposal | null = null;
  const tool = betaZodTool({
    name: "propose",
    description: "Return the holiday version of this listing.",
    inputSchema: z.object({
      title: z.string().max(140).describe("Most important words first: product + 'Christmas gift' + who it's for. Natural, not keyword soup."),
      tags: z.array(z.string().max(20)).min(10).max(13).describe("13 holiday search phrases buyers type, each 20 characters or fewer"),
      opening: z.string().max(220).describe("1-2 warm sentences for the top of the description, aimed at Christmas gift shoppers"),
    }),
    run: async (r) => {
      out = { title: r.title, tags: cleanTags(r.tags), opening: r.opening };
      return "ok";
    },
  });
  await runJob({
    purpose: "holiday_listing",
    model: MODELS.writer,
    system: `You are an Etsy SEO copywriter for a custom photo gift shop (buyers upload their own photo at checkout). Rewrite a listing for Christmas shoppers.
Rules: keep it true to the product (same item, same personalization); lead the title with what it is, then 'Christmas gift' and the best recipients (mom, dad, grandma, pet lovers, couples) that fit; tags are real phrases buyers search in November-December (e.g. "christmas gift mom", "custom photo blanket", "pet memorial gift", "personalized ornament"); no trademarks or brand names; no claims about shipping speed, discounts or free shipping; no emoji in the title. Call propose once.`,
    prompt: `Current title: ${p.title}\nCurrent tags: ${p.tags.join(", ")}\nCurrent description (start): ${p.description.slice(0, 1200)}`,
    tools: [tool],
    maxIterations: 2,
    maxTokens: 1200,
  });
  return out;
}

// Drafts the holiday version of each live listing and asks Tommy to approve each one.
export async function startHolidayRefresh(cutoff = DEFAULT_CUTOFF): Promise<string> {
  if (!printifyConfigured()) return "Printify isn't connected, so Jarvis can't see your listings.";
  const products = (await listLiveProducts()).slice(0, MAX_LISTINGS);
  if (!products.length) return "No live listings found in Printify (only TEMPLATE products).";
  const { createApproval, findAgent } = await import("@/lib/crews/crews");
  const agent = findAgent("Custom Photo", "Shop Marketer").agent;
  let made = 0;
  for (const p of products) {
    if (!getSetting(backupKey(p.id))) setSetting(backupKey(p.id), JSON.stringify({ title: p.title, description: p.description, tags: p.tags } satisfies Original));
    const original = JSON.parse(getSetting(backupKey(p.id))!) as Original;
    const prop = await propose(original).catch(() => null);
    if (!prop) continue;
    const description = holidayDescription(original.description, prop.opening, cutoff);
    createApproval({
      what: `Christmas update for "${original.title.slice(0, 70)}"\n\nTitle now: ${original.title}\nTitle new: ${prop.title}\n\nTags new: ${prop.tags.join(", ")}\n\nNew opening: 🎄 ${prop.opening}\nOrder by ${cutoff} for Christmas delivery in the US (standard shipping).`,
      why: "Holiday shoppers search for gifts, not products. Approving changes only the title, tags and description on Etsy (photos, prices and personalization stay as they are). The original is saved, so you can undo it after Christmas.",
      agentId: agent?.id,
      action: { type: "listing_text", productId: p.id, title: prop.title, description, tags: prop.tags, holiday: true },
    });
    made++;
  }
  return made ? `Drafted Christmas updates for ${made} listing${made === 1 ? "" : "s"}. They're in Waiting on you.` : "Couldn't draft any updates (the AI didn't answer). Try again in a bit.";
}

// After the holidays: put every listing back the way it was before the refresh.
export async function undoHolidayRefresh(): Promise<string> {
  if (!printifyConfigured()) return "Printify isn't connected.";
  const products = await listLiveProducts();
  let restored = 0;
  const problems: string[] = [];
  for (const p of products) {
    const raw = getSetting(backupKey(p.id));
    if (!raw) continue;
    const o = JSON.parse(raw) as Original;
    if (o.title === p.title && o.description === p.description) {
      setSetting(backupKey(p.id), "");
      continue;
    }
    try {
      await updateListingText(p.id, o);
      setSetting(backupKey(p.id), "");
      restored++;
    } catch (err) {
      problems.push(`${o.title.slice(0, 40)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return `${restored ? `Put ${restored} listing${restored === 1 ? "" : "s"} back to before Christmas.` : "Nothing to undo."}${problems.length ? ` Problems: ${problems.join("; ")}` : ""}`;
}
