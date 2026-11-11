// Finds a company's decision-maker and a verified email for them: Saleshandy Lead Finder first, then Apollo,
// then Hunter as backup (Hunter also verifies Apollo/Hunter emails).
// Generic inboxes (info@, contact@, sales@…) are never used.
import { apolloConfigured, apolloDecisionMakers, apolloRevealEmail } from "./apollo";
import { hunterConfigured, hunterDomainSearch, hunterFindEmail, hunterVerify } from "./hunter";
import { saleshandyConfigured, saleshandyDecisionMaker } from "./saleshandy";

const GENERIC = /^(info|contact|hello|hi|sales|support|service|admin|office|team|help|billing|jobs|careers|marketing|noreply|no-reply|mail|enquiries|inquiries)@/i;
const RANK = ["owner", "founder", "president", "ceo", "general manager", "operations", "office manager"];

export interface FoundContact {
  name: string | null;
  title: string | null;
  email: string;
  source: "saleshandy" | "apollo" | "hunter";
  status: string; // valid | accept_all | unknown
}

export function enrichmentConfigured() {
  return saleshandyConfigured() || apolloConfigured() || hunterConfigured();
}

export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

const rank = (title: string | null) => {
  const t = (title ?? "").toLowerCase();
  const i = RANK.findIndex((r) => t.includes(r));
  return i === -1 ? RANK.length : i;
};

async function verify(email: string, known: string | null): Promise<string> {
  if (known === "valid" || known === "verified") return "valid";
  if (!hunterConfigured()) return known ?? "unknown";
  try {
    return await hunterVerify(email);
  } catch {
    return known ?? "unknown";
  }
}

const usable = (status: string) => status === "valid" || status === "accept_all";

export async function findDecisionMaker(domainInput: string): Promise<{ contact: FoundContact | null; note: string }> {
  const domain = cleanDomain(domainInput);
  const notes: string[] = [];

  if (saleshandyConfigured()) {
    try {
      const { contact, note } = await saleshandyDecisionMaker(domain);
      if (contact && !GENERIC.test(contact.email)) {
        const v = contact.status === "valid" ? "valid" : await verify(contact.email, contact.status);
        if (usable(v)) return { contact: { ...contact, source: "saleshandy", status: v }, note: "" };
        notes.push(`${contact.email} didn't verify (${v})`);
      } else if (note) notes.push(note);
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (apolloConfigured()) {
    try {
      const people = (await apolloDecisionMakers(domain)).sort((a, b) => rank(a.title) - rank(b.title));
      for (const p of people.slice(0, 2)) {
        let email: string | null = null;
        let status: string | null = null;
        let first = p.firstName;
        let last = p.lastName;
        const revealed = await apolloRevealEmail(p.id).catch(() => null);
        if (revealed) {
          email = revealed.email;
          status = revealed.status;
          first = revealed.firstName ?? first;
          last = revealed.lastName ?? last;
        }
        // Apollo found the person but not the email: ask Hunter for it.
        if (!email && hunterConfigured() && first && last) {
          const h = await hunterFindEmail(domain, first, last).catch(() => null);
          if (h) {
            email = h.email;
            status = h.status;
          }
        }
        if (!email || GENERIC.test(email)) continue;
        const v = await verify(email, status);
        if (usable(v)) {
          return {
            contact: { name: [first, last].filter(Boolean).join(" ") || null, title: p.title, email, source: "apollo", status: v },
            note: "",
          };
        }
        notes.push(`${email} didn't verify (${v})`);
      }
      if (!people.length) notes.push("Apollo found no decision-makers");
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (hunterConfigured()) {
    try {
      const people = (await hunterDomainSearch(domain)).filter((p) => !GENERIC.test(p.email)).sort((a, b) => rank(a.position) - rank(b.position));
      for (const p of people.slice(0, 2)) {
        const v = await verify(p.email, p.status);
        if (usable(v)) {
          return {
            contact: { name: [p.firstName, p.lastName].filter(Boolean).join(" ") || null, title: p.position, email: p.email, source: "hunter", status: v },
            note: "",
          };
        }
        notes.push(`${p.email} didn't verify (${v})`);
      }
      if (!people.length) notes.push("Hunter found no personal emails");
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { contact: null, note: notes.join("; ") || "No email tools connected" };
}
