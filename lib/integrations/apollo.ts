// Apollo.io: finds the decision-makers at a company and reveals their work email.
// APOLLO_API_KEY from Apollo → Settings → Integrations → API (needs a work-email Apollo account).
// Searching people is free; revealing an email costs 1 credit (free plan: roughly 75–100 credits a month).
const API = "https://api.apollo.io/api/v1";

export const apolloConfigured = () => !!process.env.APOLLO_API_KEY;

async function apollo<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": process.env.APOLLO_API_KEY! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`Apollo: ${data.error ?? data.message ?? res.status}`);
  return data;
}

export const DECISION_MAKER_TITLES = ["owner", "co-owner", "founder", "president", "ceo", "general manager", "operations manager", "office manager"];

export interface ApolloPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
}

export async function apolloDecisionMakers(domain: string): Promise<ApolloPerson[]> {
  const d = await apollo<{ people?: { id: string; first_name?: string; last_name?: string; last_name_obfuscated?: string; title?: string }[] }>(
    "/mixed_people/api_search",
    { q_organization_domains_list: [domain], person_titles: DECISION_MAKER_TITLES, per_page: 5, page: 1 },
  );
  return (d.people ?? []).map((p) => ({ id: p.id, firstName: p.first_name ?? null, lastName: p.last_name ?? null, title: p.title ?? null }));
}

// Reveals one person's work email (1 credit when an email is found).
export async function apolloRevealEmail(personId: string) {
  const d = await apollo<{ person?: { email?: string | null; email_status?: string | null; first_name?: string; last_name?: string; title?: string } }>(
    "/people/match",
    { id: personId, reveal_personal_emails: false },
  );
  const p = d.person;
  if (!p?.email || p.email.includes("email_not_unlocked")) return null;
  return { email: p.email, status: p.email_status ?? null, firstName: p.first_name ?? null, lastName: p.last_name ?? null, title: p.title ?? null };
}
