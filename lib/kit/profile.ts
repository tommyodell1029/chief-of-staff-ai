// The client profile ("setup file"): everything decided on the kickoff call. Tommy's Jarvis writes it from the call
// notes (Builds tracker), and a client's assistant (KIT_MODE) imports it on first run to set itself up.
import { z } from "zod";

export const MODULES = ["outreach", "maps", "etsy", "social", "assistant"] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  outreach: "Cold email outreach",
  maps: "Google Maps / local visibility",
  etsy: "Etsy shop",
  social: "Social media content",
  assistant: "General business assistant",
};

export const profileSchema = z.object({
  version: z.literal(1).default(1),
  owner: z.object({
    name: z.string().min(1).describe("The client's first name, e.g. 'Mike'"),
    address: z.string().default("sir").describe("How the assistant addresses them: 'sir', 'ma'am', or their first name"),
    email: z.string().optional(),
    city: z.string().optional().describe("e.g. 'Tampa, FL'"),
    timezone: z.string().optional().describe("IANA zone, e.g. 'America/New_York'"),
    about: z.string().optional().describe("Their work and schedule in a sentence or two (hours per week for the business, etc.)"),
  }),
  assistant: z.object({
    name: z.string().min(1).default("Jarvis").describe("What they want to call their assistant"),
    personality: z.string().default("Calm, polished butler: quietly confident, dry wit, honest.").describe("One or two sentences"),
    voice: z.string().optional().describe("How the voice should sound, for ElevenLabs Voice Design"),
  }),
  businesses: z
    .array(
      z.object({
        name: z.string().min(1),
        summary: z.string().describe("What it sells and to whom, in a sentence or two"),
        offer: z.string().optional().describe("The main offer and price, if any"),
        area: z.string().optional().describe("Where customers are, e.g. 'Tampa Bay'"),
        website: z.string().optional(),
        goals: z.string().optional().describe("What they want in the next 90 days"),
        modules: z.array(z.enum(MODULES)).min(1),
      }),
    )
    .min(1),
  outreach: z
    .object({
      business: z.string().describe("Which business the outreach is for (its name)"),
      target: z.string().describe("Who to email, e.g. 'owners of HVAC companies in Tampa with weak Google profiles'"),
      offer: z.string().describe("What the emails offer, e.g. 'a free 5-point Maps audit'"),
      bookingLink: z.string().optional(),
      mailingAddress: z.string().optional().describe("Business postal address for the CAN-SPAM footer"),
      senderName: z.string().optional(),
      sendingDomain: z.string().optional().describe("The separate domain outreach sends from, e.g. 'trybrandname.com'"),
      mailboxes: z.number().int().min(1).max(5).default(1),
      warmupStart: z.string().optional().describe("YYYY-MM-DD the warm-up started"),
      warmupDays: z.number().int().min(7).max(60).default(21),
    })
    .optional(),
  notes: z.string().optional().describe("Anything else from the call worth keeping"),
});

export type KitProfile = z.infer<typeof profileSchema>;

export function parseProfile(raw: unknown): KitProfile {
  const r = profileSchema.safeParse(raw);
  if (!r.success) throw new Error(`That setup file isn't valid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

// The date outreach can start (warm-up finished), or null if warm-up hasn't started.
export function warmupReadyDate(p: KitProfile): Date | null {
  if (!p.outreach?.warmupStart) return null;
  const d = new Date(`${p.outreach.warmupStart}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + (p.outreach.warmupDays ?? 21) * 86_400_000);
}
