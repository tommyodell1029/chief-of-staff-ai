// Kit mode (Chief of Staff AI): this same codebase, running as a client's own assistant. KIT_MODE=1 turns it on.
// Everything personal comes from the client's setup file (lib/kit/profile.ts) instead of Tommy's: the assistant's
// name and wake word, the owner's name and how to address them, their businesses and crews. Tommy's own Jarvis
// (no KIT_MODE) is unchanged: these functions return his defaults.
import { BUSINESS_CONTEXT } from "@/config/business";
import { getSetting, setSetting } from "@/lib/settings";
import { parseProfile, type KitProfile } from "./profile";

export const kitMode = () => process.env.KIT_MODE === "1";

export function kitProfile(): KitProfile | null {
  if (!kitMode()) return null;
  const raw = getSetting("kit_profile");
  if (!raw) return null;
  try {
    return parseProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveKitProfile(p: KitProfile) {
  setSetting("kit_profile", JSON.stringify(p));
}

export function identity(): { assistant: string; owner: string; address: string; kit: boolean } {
  if (!kitMode()) return { assistant: "Jarvis", owner: "Tommy", address: "sir", kit: false };
  const p = kitProfile();
  return { assistant: p?.assistant.name || "Assistant", owner: p?.owner.name || "the owner", address: p?.owner.address || "sir", kit: true };
}

// The business background every agent reads: the client's, written from their setup file.
export function kitBusinessContext(p: KitProfile): string {
  const rules = BUSINESS_CONTEXT.slice(BUSINESS_CONTEXT.indexOf("Hard rules for everyone:"));
  const biz = p.businesses
    .map(
      (b, i) =>
        `${i + 1}. ${b.name}: ${b.summary}${b.offer ? ` Offer: ${b.offer}.` : ""}${b.area ? ` Area: ${b.area}.` : ""}${b.website ? ` Website: ${b.website}.` : ""}${b.goals ? ` Goals: ${b.goals}` : ""}`,
    )
    .join("\n");
  const out = p.outreach
    ? `\nOutreach (${p.outreach.business}): emailing ${p.outreach.target}, offering ${p.outreach.offer}.${p.outreach.bookingLink ? ` Booking link: ${p.outreach.bookingLink}.` : ""}`
    : "";
  return `Owner: ${p.owner.name}${p.owner.city ? `, ${p.owner.city}` : ""}. ${p.owner.about ?? ""}\n\nBusinesses:\n${biz}${out}${p.notes ? `\n\nNotes: ${p.notes}` : ""}\n\n${rules}`;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// In kit mode, rewrite any instruction or message written for Tommy's Jarvis so it fits the client.
export function personalize(text: string): string {
  if (!kitMode() || !text) return text;
  const p = kitProfile();
  const id = identity();
  let t = text;
  if (p) t = t.split(BUSINESS_CONTEXT).join(kitBusinessContext(p));
  // Tommy's agency-specific wording (LaunchPad Local's free audit) → the client's own outreach offer.
  const offer = p?.outreach?.offer ?? "the offer in the campaign brief";
  const biz = p?.outreach?.business ?? p?.businesses[0]?.name ?? "the business";
  t = t
    .replace(/About Tommy's life: [^\n`]*?Respect that time\./g, p?.owner.about ? `About Tommy: ${p.owner.about} Respect their time.` : "")
    .replace(/Calm, polished, quietly confident, dry British wit used sparingly\./g, p?.assistant.personality ?? "Calm, polished, quietly confident.")
    .replace(/Call him "sir" mostly, "Tommy" sometimes\./g, `Call them "${id.address}" mostly, "Tommy" sometimes. Wherever these instructions say him or his, they mean Tommy.`)
    .replace(/LaunchPad Local works by email, with no sales calls: if they asked for the free audit,[^.]*\.[^.]*listing link\./g, "Give the next step from the campaign brief.")
    .replace(/to a business owner who said yes to LaunchPad Local's free 5-point audit\. Thank them; say the audit will be emailed within 2 business days; if their business or Google listing isn't clear, ask them to confirm it\./g, `to a prospect who said yes to ${offer}. Thank them and give the next step from the campaign brief.`)
    .replace(/LaunchPad Local/g, biz)
    .replace(/Jacksonville(, FL)?/g, p?.owner.city || p?.businesses[0]?.area || "their area")
    .replace(/, inspired by the butler-like AI from the Iron Man films but an original character\. Never claim to be the film character or imitate an actor\./g, `. Personality: ${p?.assistant.personality ?? "calm, polished and honest"}`)
    .replace(/\bJarvis's\b/g, `${id.assistant}'s`)
    .replace(/\bJarvis\b/g, id.assistant)
    .replace(/\bTommy's\b/g, `${id.owner}'s`)
    .replace(/\bTommy\b/g, id.owner);
  if (id.address.toLowerCase() !== "sir") t = t.replace(/\bSir\b/g, cap(id.address)).replace(/\bsir\b/g, id.address);
  return t;
}
