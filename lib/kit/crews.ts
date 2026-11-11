// A client's crews, built from their setup file: one business per entry, agents by the modules picked on the
// kickoff call. Everything starts as a draft: nothing runs until the client presses Launch.
import { eq } from "drizzle-orm";
import { AGENT_MODELS, type CrewTool } from "@/config/business";
import { getDb, schema } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import type { KitProfile, Module } from "./profile";

interface AgentSpec {
  name: string;
  job: string;
  model: "writer" | "worker";
  tools: CrewTool[];
}

function agentsFor(b: KitProfile["businesses"][number], p: KitProfile): AgentSpec[] {
  const area = b.area ? ` in and around ${b.area}` : "";
  const out = p.outreach && p.outreach.business === b.name ? p.outreach : null;
  const specs: Record<Module, AgentSpec[]> = {
    outreach: [
      {
        name: "Prospector",
        job: `Find and qualify prospects for ${b.name}: ${out?.target ?? "the customers in the campaign brief"}${area}. Use maps_search for local businesses (Google's own order, ratings, reviews, website) and web_search to fill gaps. Skip chains, closed businesses and anyone without their own website. Add every qualified company with add_leads (real domain, city, phone, and a notes line with the facts you found). Never invent facts.`,
        model: "worker",
        tools: ["maps_search", "web_search", "save_note", "add_leads"],
      },
      {
        name: "Outreach Writer",
        job: `Write short, honest cold emails and follow-ups for ${b.name}, offering ${out?.offer ?? "the offer in the campaign brief"} to ${out?.target ?? "the prospects found"}. 60-120 words, specific to each prospect, one clear next step${out?.bookingLink ? ` (booking link: ${out.bookingLink})` : ""}. Every email carries the sender's name, the business postal address and an easy way to opt out. No income claims, no guarantees, no fake urgency. Anything that sends goes to the owner for approval.`,
        model: "writer",
        tools: ["web_search", "save_note", "request_approval", "email_draft"],
      },
    ],
    maps: [
      {
        name: "Local Visibility",
        job: `Keep ${b.name} visible on Google Maps${area}: draft one Google Business Profile post a week (local, specific, one call to action), draft replies to new reviews, and run a monthly check of where the business ranks for its main searches with maps_search. Save drafts with save_file for the owner to paste. Never guarantee rankings and never fake reviews.`,
        model: "writer",
        tools: ["maps_search", "web_search", "save_note"],
      },
    ],
    etsy: [
      {
        name: "Shop Marketer",
        job: `Grow ${b.name} on Etsy: product ideas from current trends, SEO titles and 13 tags, descriptions and seasonal drops ahead of holidays. Publishing waits for the owner's approval.`,
        model: "writer",
        tools: ["web_search", "save_note", "request_approval", "create_listing"],
      },
      {
        name: "Customer Care",
        job: `Draft friendly, short replies to ${b.name}'s buyer messages and reviews. Never promise refunds or discounts without approval.`,
        model: "worker",
        tools: ["save_note", "request_approval"],
      },
    ],
    social: [
      {
        name: "Content Planner",
        job: `Plan ${b.name}'s social posts for the week from current trends: hooks, captions, hashtags (at most 5), image or video ideas and the best times to post. Save the plan with save_file so the owner can post it. Platform-safe, honest, no income claims.`,
        model: "writer",
        tools: ["web_search", "save_note"],
      },
    ],
    assistant: [
      {
        name: "Business Assistant",
        job: `Help run ${b.name}: research questions, draft documents and emails, make plans and checklists. Save anything worth keeping with save_file. Anything that sends, spends or posts goes to the owner for approval.`,
        model: "writer",
        tools: ["web_search", "save_note", "request_approval"],
      },
    ],
  };
  return [...new Set(b.modules)].flatMap((m) => specs[m]);
}

// Creates any businesses from the setup file that don't exist yet (re-importing never duplicates them).
export function createKitCrews(p: KitProfile): number {
  const db = getDb();
  let created = 0;
  for (const b of p.businesses) {
    if (db.select().from(schema.businesses).where(eq(schema.businesses.name, b.name)).get()) continue;
    const notes = [b.summary, b.offer && `Offer: ${b.offer}`, b.area && `Area: ${b.area}`, b.website && `Website: ${b.website}`, b.goals && `Goals: ${b.goals}`].filter(Boolean).join(" ");
    const biz = db.insert(schema.businesses).values({ name: b.name, status: "draft", notes }).returning().get();
    const ids = new Map<string, number>();
    for (const a of agentsFor(b, p)) {
      const row = db
        .insert(schema.agents)
        .values({ businessId: biz.id, name: a.name, job: a.job, systemPrompt: "", model: AGENT_MODELS[a.model].id, allowedTools: JSON.stringify(a.tools), autonomyLevel: "approval_required", status: "draft" })
        .returning()
        .get();
      ids.set(a.name, row.id);
    }
    if (ids.has("Prospector") && ids.has("Outreach Writer")) {
      db.update(schema.agents).set({ handoffTo: JSON.stringify([ids.get("Outreach Writer")]) }).where(eq(schema.agents.id, ids.get("Prospector")!)).run();
    }
    setSetting(`routes_default:${biz.id}`, "1"); // these routes are the client's own; don't add Tommy's defaults
    created++;
  }
  // Outreach: a draft campaign (approved at Launch) and the sender details for the email footer.
  const o = p.outreach;
  if (o) {
    const biz = db.select().from(schema.businesses).where(eq(schema.businesses.name, o.business)).get();
    const exists = db.select().from(schema.campaigns).all().some((c) => c.businessId === biz?.id);
    if (biz && !exists) {
      db.insert(schema.campaigns)
        .values({
          businessId: biz.id,
          name: `${o.business} outreach`,
          brief: `Who: ${o.target}\nOffer: ${o.offer}\n${o.bookingLink ? `Next step: book a time at ${o.bookingLink}\n` : ""}Tone: friendly, specific, short. No income claims or guarantees.`,
          status: "draft",
          dailyLimit: 5,
          sendVia: process.env.SALESHANDY_API_KEY ? "saleshandy" : "jarvis",
        })
        .run();
    }
    if (o.senderName) setSetting("outreach_sender_name", o.senderName);
    if (o.mailingAddress) setSetting("outreach_address", o.mailingAddress);
    if (o.bookingLink) setSetting("outreach_booking_link", o.bookingLink);
  }
  return created;
}
