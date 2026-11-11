// Hunter.io: finds and verifies business email addresses. HUNTER_API_KEY from hunter.io → API.
// Free plan: roughly 25 searches + 50 verifications a month.
const API = "https://api.hunter.io/v2";

export const hunterConfigured = () => !!process.env.HUNTER_API_KEY;

async function hunter<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, api_key: process.env.HUNTER_API_KEY! });
  const res = await fetch(`${API}${path}?${qs}`, { signal: AbortSignal.timeout(30_000) });
  const data = (await res.json()) as { data: T; errors?: { details?: string }[] };
  if (!res.ok) throw new Error(`Hunter: ${data.errors?.[0]?.details ?? res.status}`);
  return data.data;
}

export interface HunterPerson {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  confidence: number;
  status: string | null;
}

// Personal (not generic) addresses at a company, executives and senior people first.
export async function hunterDomainSearch(domain: string): Promise<HunterPerson[]> {
  const d = await hunter<{
    emails: { value: string; type: string; first_name: string | null; last_name: string | null; position: string | null; confidence: number; seniority: string | null; verification?: { status: string | null } }[];
  }>("/domain-search", { domain, type: "personal", seniority: "executive,senior", limit: "5" });
  return d.emails.map((e) => ({
    email: e.value,
    firstName: e.first_name,
    lastName: e.last_name,
    position: e.position,
    confidence: e.confidence,
    status: e.verification?.status ?? null,
  }));
}

// The most likely address for a named person at a company.
export async function hunterFindEmail(domain: string, firstName: string, lastName: string) {
  const d = await hunter<{ email: string | null; score: number; position: string | null; verification?: { status: string | null } }>("/email-finder", {
    domain,
    first_name: firstName,
    last_name: lastName,
  });
  return d.email ? { email: d.email, score: d.score, status: d.verification?.status ?? null } : null;
}

// valid | invalid | accept_all | webmail | disposable | unknown
export async function hunterVerify(email: string): Promise<string> {
  const d = await hunter<{ status: string }>("/email-verifier", { email });
  return d.status;
}
