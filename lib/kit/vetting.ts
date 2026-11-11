// "Can you run this?" The owner describes a business they want to run; the assistant researches it on the web and
// gives an honest verdict on whether its crews can actually run it, what the owner would still have to do, the
// real costs and risks, and the first steps. If the verdict isn't "no", one press turns it into a business with a
// draft crew (nothing runs until Launch / approval). Ideas are kept in the settings table (key "biz_ideas").
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODELS } from "@/config/models";
import { runJob, webSearch } from "@/lib/ai";
import { getSetting, setSetting } from "@/lib/settings";
import { createKitCrews } from "./crews";
import { kitMode, kitProfile, saveKitProfile } from "./kit";
import { MODULES, MODULE_LABELS, type KitProfile } from "./profile";

export const verdictSchema = z.object({
  name: z.string().describe("A short working name for the business"),
  verdict: z.enum(["yes", "partly", "no"]).describe("yes: the crews can run most of it; partly: they can run a real part but the owner must do key pieces; no: it can't be run this way, or shouldn't be"),
  headline: z.string().describe("One plain sentence with the verdict and the main reason"),
  summary: z.string().describe("What the business sells and to whom, in a sentence or two"),
  assistantDoes: z.array(z.string()).describe("Specific jobs the crews would do every week"),
  ownerDoes: z.array(z.string()).describe("What the owner must still do themselves (physical work, calls, approvals, accounts, money)"),
  cantDo: z.array(z.string()).describe("Parts the assistant can't do at all"),
  startupCost: z.string().describe("Realistic money needed to start, with what it's for, e.g. '$50–150: domain, Etsy fees, samples'"),
  timePerWeek: z.string().describe("Realistic owner hours per week once it's running"),
  competition: z.string().describe("What the research found about demand and competition, in two or three sentences, citing what you saw"),
  risks: z.array(z.string()).describe("Honest risks: saturation, platform rules, licensing, refunds, slow start"),
  firstSteps: z.array(z.string()).describe("The first 3–6 steps, in order"),
  modules: z.array(z.enum(MODULES)).describe("Which crews to build if they go ahead"),
  offer: z.string().optional().describe("The main offer and a sensible starting price, if there is one"),
  area: z.string().optional().describe("Where the customers are, if local"),
  outreach: z.object({ target: z.string(), offer: z.string() }).optional().describe("Only if cold email fits: who to email and what to offer"),
});
export type Verdict = z.infer<typeof verdictSchema>;

export interface Idea {
  id: number;
  idea: string;
  status: "researching" | "done" | "failed" | "adopted" | "dismissed";
  result?: Verdict;
  error?: string;
  createdAt: number;
}

const KEY = "biz_ideas";
export function listIdeas(): Idea[] {
  try {
    return JSON.parse(getSetting(KEY) || "[]") as Idea[];
  } catch {
    return [];
  }
}
function saveIdeas(ideas: Idea[]) {
  setSetting(KEY, JSON.stringify(ideas.slice(0, 30)));
}
function update(id: number, changes: Partial<Idea>) {
  saveIdeas(listIdeas().map((i) => (i.id === id ? { ...i, ...changes } : i)));
}
export const getIdea = (id: number) => listIdeas().find((i) => i.id === id);

// What the crews really can and can't do: the research is judged against this, not against wishful thinking.
export const CAPABILITIES = `What your crews CAN do (each runs on a schedule or when asked, and anything that sends, spends or posts waits for the owner's approval):
- Research on the web: markets, competitors, prices, trends, suppliers, prospects.
- Find local businesses on Google Maps (names, ratings, reviews, websites, phone numbers).
- Write: cold emails and follow-ups, product listings with SEO titles and tags, social captions and post plans, blog posts, proposals, replies to customers and reviews, documents, checklists.
- Send cold email from a warmed-up mailbox, a few a day, with an opt-out, and track replies.
- Create Etsy listings (with the owner's approval) and draft order follow-ups.
- Make social content: images, short voiced reels and captions. The owner posts them on Instagram and TikTok (posting reminders included).
- Keep notes, save files, report every morning, and work overnight within a dollar budget.
What they CANNOT do:
- Physical work, deliveries, in-person meetings, making or shipping products by hand.
- Live sales or phone calls (unless the owner turned calls on), video meetings, being on camera as a real person.
- Spend money, run paid ads, sign contracts or move money on their own.
- Log in to sites without a connection, solve captchas, or post on Instagram or TikTok directly.
- Give licensed advice (legal, medical, financial, tax) as the product.`;

const SYSTEM = `You are a sharp, honest business analyst working for the owner's AI assistant. The owner describes a business they want to run with the assistant's crews. Research it with web_search (demand, competition, typical prices, startup costs, platform rules, licensing) and decide honestly whether the crews below can actually run it.

${CAPABILITIES}

Rules:
- Be honest, not encouraging. If most of the work is something the crews can't do, say "partly" or "no" and why.
- Say "no" for anything illegal, deceptive, adult, gambling, MLM or pyramid-style, get-rich-quick, fake reviews, spam, or anything that needs a license the owner doesn't have. Suggest a nearby idea that would work instead in the headline.
- Never estimate income or promise results. Talk about costs, time, demand and risk instead.
- Be specific: real numbers and examples from what you found. Plain words, short sentences.
- Pick crews only from: ${Object.entries(MODULE_LABELS)
  .map(([k, v]) => `${k} (${v})`)
  .join(", ")}.
- Call save_verdict exactly once at the end.`;

// Starts the research in the background (it takes a minute or two); the page polls listIdeas().
export function vetIdea(text: string, about?: string): Idea {
  const idea = text.trim().slice(0, 2000);
  if (idea.length < 8) throw new Error("Tell me a bit more about the business you want to run.");
  const ideas = listIdeas();
  const id = Math.max(0, ...ideas.map((i) => i.id)) + 1;
  const row: Idea = { id, idea, status: "researching", createdAt: Date.now() };
  saveIdeas([row, ...ideas]);
  void research(row, about).catch((err) => update(id, { status: "failed", error: err instanceof Error ? err.message : String(err) }));
  return row;
}

async function research(row: Idea, about?: string) {
  let result: Verdict | null = null;
  const tool = betaZodTool({
    name: "save_verdict",
    description: "Save your verdict on the business idea.",
    inputSchema: verdictSchema,
    run: async (v) => {
      result = verdictSchema.parse(v);
      return "Saved.";
    },
  });
  const p = kitProfile();
  const owner = about ?? [p?.owner.city && `Lives in ${p.owner.city}.`, p?.owner.about].filter(Boolean).join(" ");
  await runJob({
    purpose: "business_vet",
    model: MODELS.writer,
    system: SYSTEM,
    prompt: `The business the owner wants to run:\n${row.idea}${owner ? `\n\nAbout the owner: ${owner}` : ""}`,
    tools: [webSearch(MODELS.writer.id, 6), tool],
    maxIterations: 10,
    maxTokens: 6000,
  });
  if (!result) throw new Error("The research didn't finish. Try again, maybe with a little more detail.");
  update(row.id, { status: "done", result });
  const v = result as Verdict;
  const { notifyAll } = await import("@/lib/push");
  await notifyAll({ title: `Can I run it? ${v.verdict === "yes" ? "Yes" : v.verdict === "partly" ? "Partly" : "No"}: ${v.name}`, body: v.headline, url: `/ideas?id=${row.id}`, tag: `idea-${row.id}`, kind: "briefing", say: v.headline }).catch(() => {});
}

// Turns a vetted idea into a business with a draft crew (and adds it to the setup file on a client's assistant).
export function adoptIdea(id: number): { message: string } {
  const idea = getIdea(id);
  const v = idea?.result;
  if (!idea || !v) throw new Error("That idea isn't researched yet.");
  if (v.verdict === "no") throw new Error("The research said this one can't be run this way. Try the suggested idea instead.");
  const business: KitProfile["businesses"][number] = {
    name: v.name,
    summary: v.summary,
    offer: v.offer,
    area: v.area,
    goals: `First steps: ${v.firstSteps.join("; ")}`,
    modules: v.modules.length ? v.modules : ["assistant"],
  };
  if (v.outreach && !business.modules.includes("outreach")) business.modules.push("outreach");
  const saved = kitProfile();
  const base: KitProfile = saved ?? { version: 1, owner: { name: "Owner", address: "sir" }, assistant: { name: "Assistant", personality: "" }, businesses: [] };
  const profile: KitProfile = { ...base, businesses: [...base.businesses.filter((b) => b.name !== business.name), business] };
  if (v.outreach && !profile.outreach) profile.outreach = { business: v.name, target: v.outreach.target, offer: v.outreach.offer, mailboxes: 1, warmupDays: 21 };
  if (kitMode() && saved) saveKitProfile(profile);
  createKitCrews({ ...profile, businesses: [business], outreach: profile.outreach?.business === v.name ? profile.outreach : undefined });
  update(id, { status: "adopted" });
  return { message: `${v.name} is set up with a draft crew (${business.modules.map((m) => MODULE_LABELS[m]).join(", ")}). Nothing runs until you approve it.` };
}

export function dismissIdea(id: number) {
  update(id, { status: "dismissed" });
}

// Short text version, for voice and chat.
export function ideaText(i: Idea): string {
  if (i.status === "researching") return `Still researching "${i.idea.slice(0, 60)}". Give it a minute or two.`;
  if (i.status === "failed") return `The research on "${i.idea.slice(0, 60)}" failed: ${i.error}`;
  const v = i.result;
  if (!v) return "No result yet.";
  return `${v.headline} I'd handle: ${v.assistantDoes.slice(0, 3).join("; ")}. You'd handle: ${v.ownerDoes.slice(0, 3).join("; ")}. Startup cost: ${v.startupCost}. About ${v.timePerWeek} of your time a week. Biggest risk: ${v.risks[0] ?? "none found"}.`;
}
