// Stripe: reads sales and recurring revenue for the dashboard; creates payment links only after Tommy approves.
// Uses a Stripe restricted key (STRIPE_API_KEY). See docs/connections-setup.md.
const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_API_KEY;
}

async function stripe<T>(path: string, init?: { method?: string; form?: Record<string, string> }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_API_KEY}`,
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.form ? new URLSearchParams(init.form) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
  return data;
}

interface Charge {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  paid: boolean;
  status: string;
  description: string | null;
  billing_details?: { name?: string | null; email?: string | null };
}
interface Subscription {
  id: string;
  status: string;
  items: { data: { quantity?: number; price: { unit_amount: number | null; recurring: { interval: string; interval_count: number } | null } }[] };
}

export interface StripeSummary {
  weekUsd: number;
  monthUsd: number;
  mrrUsd: number;
  activeSubscriptions: number;
  recent: { amountUsd: number; when: string; who: string; what: string }[];
}

let cache: { at: number; data: StripeSummary } | null = null;

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

// Money in (successful charges minus refunds) this week and month, MRR from active subscriptions.
export async function stripeSummary(): Promise<StripeSummary> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const monthStart = new Date();
  monthStart.setHours(0, 0, 0, 0);
  monthStart.setDate(1);
  const weekStart = startOfWeek();
  const since = Math.floor(Math.min(monthStart.getTime(), weekStart.getTime()) / 1000);

  const charges = await stripe<{ data: Charge[] }>(`/charges?limit=100&created[gte]=${since}`);
  const good = charges.data.filter((c) => c.paid && c.status === "succeeded" && c.currency === "usd");
  const net = (c: Charge) => (c.amount - c.amount_refunded) / 100;
  const weekUsd = good.filter((c) => c.created * 1000 >= weekStart.getTime()).reduce((s, c) => s + net(c), 0);
  const monthUsd = good.filter((c) => c.created * 1000 >= monthStart.getTime()).reduce((s, c) => s + net(c), 0);

  const subs = await stripe<{ data: Subscription[] }>(`/subscriptions?status=active&limit=100`);
  let mrrUsd = 0;
  for (const s of subs.data) {
    for (const item of s.items.data) {
      const r = item.price.recurring;
      if (!r || item.price.unit_amount == null) continue;
      const perInterval = (item.price.unit_amount / 100) * (item.quantity ?? 1);
      const months = r.interval === "year" ? 12 : r.interval === "week" ? 12 / 52 : r.interval === "day" ? 12 / 365 : 1;
      mrrUsd += perInterval / (months * r.interval_count);
    }
  }

  const data: StripeSummary = {
    weekUsd: Math.round(weekUsd * 100) / 100,
    monthUsd: Math.round(monthUsd * 100) / 100,
    mrrUsd: Math.round(mrrUsd * 100) / 100,
    activeSubscriptions: subs.data.length,
    recent: good.slice(0, 8).map((c) => ({
      amountUsd: net(c),
      when: new Date(c.created * 1000).toLocaleString("en-US", { timeZone: process.env.TZ || undefined }),
      who: c.billing_details?.name || c.billing_details?.email || "customer",
      what: c.description ?? "",
    })),
  };
  cache = { at: Date.now(), data };
  return data;
}

// Creates a product + price + shareable payment link. Only ever called after Tommy approves.
export async function createPaymentLink(name: string, amountUsd: number, monthly: boolean): Promise<string> {
  const price = await stripe<{ id: string }>("/prices", {
    method: "POST",
    form: {
      currency: "usd",
      unit_amount: String(Math.round(amountUsd * 100)),
      "product_data[name]": name,
      ...(monthly ? { "recurring[interval]": "month" } : {}),
    },
  });
  const link = await stripe<{ url: string }>("/payment_links", {
    method: "POST",
    form: { "line_items[0][price]": price.id, "line_items[0][quantity]": "1" },
  });
  cache = null;
  return link.url;
}
