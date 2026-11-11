// Etsy (Seller App for Tommy's own shop): reads orders/revenue and reviews. Listings are made through Printify,
// so products, mockups and fulfillment stay linked. Setup: docs/connections-setup.md → ETSY_API_KEY (+ ETSY_SHARED_SECRET).
import { createHash, randomBytes } from "node:crypto";
import { publicBaseUrl } from "@/lib/publicUrl";
import { getSetting, setSetting } from "@/lib/settings";

const API = "https://openapi.etsy.com/v3/application";
const SCOPES = "transactions_r shops_r listings_r";

export const etsyAppConfigured = () => !!process.env.ETSY_API_KEY;
export const etsyConnected = () => etsyAppConfigured() && !!getSetting("etsy_refresh");

// Etsy's x-api-key is "keystring:sharedsecret" for newer apps; the keystring alone for older ones.
const apiKeyHeader = () => (process.env.ETSY_SHARED_SECRET ? `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}` : process.env.ETSY_API_KEY!);

export function etsyRedirectUri(req: Request): string {
  return `${publicBaseUrl(req)}/api/etsy/callback`;
}

// PKCE: a one-time secret proves the callback belongs to this sign-in.
export function startEtsyConnect(redirectUri: string) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = `https://www.etsy.com/oauth/connect?${new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    client_id: process.env.ETSY_API_KEY!,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
  return { url, verifier, state };
}

async function token(params: Record<string, string>) {
  const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.ETSY_API_KEY!, ...params }),
  });
  const d = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !d.access_token) throw new Error(`Etsy sign-in failed: ${d.error_description ?? d.error ?? res.status}`);
  setSetting("etsy_access", d.access_token);
  if (d.refresh_token) setSetting("etsy_refresh", d.refresh_token);
  setSetting("etsy_expires", String(Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000));
  return d.access_token;
}

export async function finishEtsyConnect(code: string, verifier: string, redirectUri: string) {
  const access = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  const userId = access.split(".")[0]; // Etsy access tokens start with the user id
  const shops = await etsy<{ shop_id?: number; shop_name?: string; results?: { shop_id: number; shop_name: string }[] }>(`/users/${userId}/shops`);
  const shop = shops.results?.[0] ?? shops;
  if (!shop?.shop_id) throw new Error("No Etsy shop found on that account.");
  setSetting("etsy_shop_id", String(shop.shop_id));
  setSetting("etsy_shop_name", shop.shop_name ?? "");
  return shop.shop_name ?? String(shop.shop_id);
}

async function accessToken() {
  const expires = Number(getSetting("etsy_expires") ?? 0);
  const access = getSetting("etsy_access");
  if (access && Date.now() < expires) return access;
  const refresh = getSetting("etsy_refresh");
  if (!refresh) throw new Error("Etsy isn't connected. Connections → Connect Etsy.");
  return token({ grant_type: "refresh_token", refresh_token: refresh });
}

async function etsy<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "x-api-key": apiKeyHeader(), Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`Etsy: ${d.error ?? res.status}`);
  return d;
}

interface Receipt {
  receipt_id: number;
  name: string;
  is_paid: boolean;
  create_timestamp: number;
  grandtotal: { amount: number; divisor: number; currency_code: string };
  transactions?: { title: string; quantity?: number; variations?: { formatted_name: string; formatted_value: string }[] }[];
  message_from_buyer?: string | null;
}

export interface OrderDetail {
  id: number;
  at: number;
  buyer: string;
  total: number;
  message: string;
  items: { title: string; quantity: number; options: { name: string; value: string }[] }[];
}

// Paid orders newer than a timestamp (seconds) with everything the Order Desk needs: each item's options
// (including the buyer's personalization) and the buyer's note.
export async function etsyOrderDetails(sinceSec: number): Promise<OrderDetail[]> {
  const shopId = getSetting("etsy_shop_id");
  const r = await etsy<{ results: Receipt[] }>(`/shops/${shopId}/receipts?min_created=${sinceSec + 1}&limit=25`);
  return r.results
    .filter((x) => x.is_paid)
    .map((x) => ({
      id: x.receipt_id,
      at: x.create_timestamp,
      buyer: x.name.split(" ")[0] || "a buyer",
      total: x.grandtotal.amount / x.grandtotal.divisor,
      message: x.message_from_buyer ?? "",
      items: (x.transactions ?? []).map((t) => ({
        title: t.title,
        quantity: t.quantity ?? 1,
        options: (t.variations ?? []).map((v) => ({ name: v.formatted_name, value: v.formatted_value })),
      })),
    }))
    .sort((a, b) => a.at - b.at);
}

export interface EtsySummary {
  shop: string;
  weekUsd: number;
  monthUsd: number;
  ordersThisWeek: number;
  recent: { when: string; buyer: string; total: number; items: string }[];
  reviews: { rating: number; text: string; when: string }[];
}

let cache: { at: number; data: EtsySummary } | null = null;

export async function etsySummary(): Promise<EtsySummary> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const shopId = getSetting("etsy_shop_id");
  const week = new Date();
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  const month = new Date();
  month.setHours(0, 0, 0, 0);
  month.setDate(1);
  const since = Math.floor(Math.min(week.getTime(), month.getTime()) / 1000);
  const receipts = await etsy<{ results: Receipt[] }>(`/shops/${shopId}/receipts?min_created=${since}&limit=100`);
  const paid = receipts.results.filter((r) => r.is_paid);
  const usd = (r: Receipt) => r.grandtotal.amount / r.grandtotal.divisor;
  const inWeek = paid.filter((r) => r.create_timestamp * 1000 >= week.getTime());
  const reviews = await etsy<{ results: { rating: number; review: string | null; create_timestamp: number }[] }>(`/shops/${shopId}/reviews?limit=5`).catch(() => ({ results: [] }));
  const data: EtsySummary = {
    shop: getSetting("etsy_shop_name") ?? "",
    weekUsd: Math.round(inWeek.reduce((s, r) => s + usd(r), 0) * 100) / 100,
    monthUsd: Math.round(paid.filter((r) => r.create_timestamp * 1000 >= month.getTime()).reduce((s, r) => s + usd(r), 0) * 100) / 100,
    ordersThisWeek: inWeek.length,
    recent: paid.slice(0, 8).map((r) => ({
      when: new Date(r.create_timestamp * 1000).toLocaleString("en-US", { timeZone: process.env.TZ || undefined }),
      buyer: r.name,
      total: usd(r),
      items: (r.transactions ?? []).map((t) => t.title).join(", "),
    })),
    reviews: reviews.results.map((r) => ({ rating: r.rating, text: r.review ?? "", when: new Date(r.create_timestamp * 1000).toLocaleDateString() })),
  };
  cache = { at: Date.now(), data };
  return data;
}

// Paid orders newer than a timestamp (seconds), newest first. Used for "a new order just came in".
export async function etsyOrdersSince(sinceSec: number) {
  const shopId = getSetting("etsy_shop_id");
  const r = await etsy<{ results: Receipt[] }>(`/shops/${shopId}/receipts?min_created=${sinceSec + 1}&limit=25`);
  return r.results
    .filter((x) => x.is_paid)
    .map((x) => ({
      id: x.receipt_id,
      at: x.create_timestamp,
      buyer: x.name.split(" ")[0] || "a buyer",
      total: x.grandtotal.amount / x.grandtotal.divisor,
      items: (x.transactions ?? []).map((t) => t.title.split(",")[0]).join(", "),
    }))
    .sort((a, b) => b.at - a.at);
}
