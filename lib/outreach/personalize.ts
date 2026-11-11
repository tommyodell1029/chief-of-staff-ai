// Two extra fields for each lead going into a Saleshandy sequence, so the emails can open with something specific:
// - Category: what the business is ("dentist"), from the Prospector's notes ("dentist; #6 for dentist Jacksonville; …").
// - Personal Line: one true sentence about the business, written only from those notes (fast model, one call per
//   batch). Leads with no usable facts get a plain, honest fallback line.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODELS } from "@/config/models";
import { runJob } from "@/lib/ai";
import type { Lead } from "@/lib/db/schema";

export function categoryOf(notes: string | null): string {
  const first = (notes ?? "").split(/[;\n]/)[0].trim().toLowerCase();
  // A category is a short label ("dentist", "hair salon"), not a sentence of notes.
  return first && first.split(/\s+/).length <= 4 && !/[#★\d]/.test(first) ? first : "";
}

export const fallbackLine = (l: Pick<Lead, "company" | "city">) =>
  `I was looking at ${l.city ? `${l.city} ` : ""}businesses on Google Maps and came across ${l.company}.`;

export async function personalLines(leads: Pick<Lead, "id" | "company" | "city" | "notes">[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const withFacts = leads.filter((l) => l.notes && l.notes.length > 10);
  if (withFacts.length) {
    const tool = betaZodTool({
      name: "lines",
      description: "Return one opening line per lead.",
      inputSchema: z.object({ lines: z.array(z.object({ id: z.number(), line: z.string() })) }),
      run: async ({ lines }) => {
        for (const x of lines) {
          const line = x.line.trim().replace(/\s+/g, " ");
          if (line && line.length <= 220) out.set(x.id, line);
        }
        return "ok";
      },
    });
    await runJob({
      purpose: "outreach_personal_lines",
      model: MODELS.worker,
      system: `Write the first sentence of a short cold email from Tommy (LaunchPad Local, Jacksonville) to each local business owner. One sentence, under 30 words, plain and friendly, about something specific and TRUE from the notes: e.g. where they show up on Google Maps for a "near me" search, how many reviews they have or how recent, missing hours or photos. Use ONLY facts in the notes; never invent numbers, never exaggerate, no compliments you can't back up, no criticism that sounds rude ("you're failing"). Don't pitch anything; the rest of the email does that. Examples: "I searched 'dentist near me' from Southside and Bright Smile Dental came up sixth on the map." / "I noticed Joe's Auto has great reviews, but the newest one is from last spring."`,
      prompt: withFacts.map((l) => `id ${l.id}: ${l.company}${l.city ? ` (${l.city})` : ""}. Notes: ${l.notes!.slice(0, 400)}`).join("\n"),
      tools: [tool],
      maxIterations: 2,
      maxTokens: 4000,
    }).catch((err) => console.error("[personalize]", err instanceof Error ? err.message : err));
  }
  for (const l of leads) if (!out.has(l.id)) out.set(l.id, fallbackLine(l));
  return out;
}
