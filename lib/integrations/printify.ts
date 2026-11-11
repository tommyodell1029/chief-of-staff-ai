// Printify: makes Etsy listings from Tommy's template products and watches orders for problems.
// PRINTIFY_API_TOKEN from Printify → My Profile → Connections (personal access token, lasts a year).
// Etsy orders reach Printify by themselves through the Printify–Etsy connection, so fulfillment is already automatic.
const API = "https://api.printify.com/v1";

export const printifyConfigured = () => !!process.env.PRINTIFY_API_TOKEN;

async function pf<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}`, "Content-Type": "application/json", "User-Agent": "Jarvis" },
    body: init?.json ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const d = (await res.json().catch(() => ({}))) as T & { message?: string; errors?: unknown };
  if (!res.ok) throw new Error(`Printify: ${d.message ?? res.status}${d.errors ? ` ${JSON.stringify(d.errors).slice(0, 300)}` : ""}`);
  return d;
}

let shopCache: number | null = null;
// The Printify shop connected to Etsy (or the only shop).
export async function printifyShopId(): Promise<number> {
  if (shopCache) return shopCache;
  const shops = await pf<{ id: number; title: string; sales_channel: string }[]>("/shops.json");
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) throw new Error("No Printify shop found. Connect your Etsy shop inside Printify first.");
  shopCache = shop.id;
  return shop.id;
}

interface Product {
  id: string;
  title: string;
  description: string;
  tags: string[];
  blueprint_id: number;
  print_provider_id: number;
  visible: boolean;
  variants: { id: number; price: number; is_enabled: boolean }[];
  print_areas: { variant_ids: number[]; placeholders: { position: string; images: { id: string; x: number; y: number; scale: number; angle: number }[] }[] }[];
  external?: { id?: string; handle?: string };
}

// For the Connections page: which Printify shop Jarvis sees and how many products it has.
export async function printifyStatus(): Promise<string> {
  const shops = await pf<{ id: number; title: string; sales_channel: string }[]>("/shops.json");
  const shop = shops.find((s) => s.sales_channel === "etsy") ?? shops[0];
  if (!shop) return "Connected, but no shop yet: connect your Etsy store inside Printify";
  const d = await pf<{ data: Product[]; total?: number }>(`/shops/${shop.id}/products.json?limit=50`);
  const templates = d.data.filter((p) => /^template/i.test(p.title)).length;
  const total = d.total ?? d.data.length;
  return `${shop.title}${shop.sales_channel ? ` (${shop.sales_channel})` : ""} · ${total} product${total === 1 ? "" : "s"}${templates ? ` · ${templates} TEMPLATE` : ""} · watching orders`;
}

// Products whose title starts with "TEMPLATE" are Tommy's starting points (one per product type).
export async function listTemplates() {
  const shop = await printifyShopId();
  const d = await pf<{ data: Product[] }>(`/shops/${shop}/products.json?limit=50`);
  return d.data
    .filter((p) => /^template/i.test(p.title))
    .map((p) => ({ id: p.id, title: p.title.replace(/^template[:\s-]*/i, ""), prices: [...new Set(p.variants.filter((v) => v.is_enabled).map((v) => v.price / 100))] }));
}

// Copies a template with a new design image, title, description and tags. Not published until approved.
export async function createFromTemplate(o: { templateId: string; image: Buffer; title: string; description: string; tags: string[]; priceUsd?: number }) {
  const shop = await printifyShopId();
  const t = await pf<Product>(`/shops/${shop}/products/${o.templateId}.json`);
  const upload = await pf<{ id: string }>("/uploads/images.json", {
    method: "POST",
    json: { file_name: `jarvis-${Date.now()}.jpg`, contents: o.image.toString("base64") },
  });
  const product = await pf<{ id: string }>(`/shops/${shop}/products.json`, {
    method: "POST",
    json: {
      title: o.title.slice(0, 140),
      description: o.description,
      tags: o.tags.slice(0, 13),
      blueprint_id: t.blueprint_id,
      print_provider_id: t.print_provider_id,
      variants: t.variants
        .filter((v) => v.is_enabled)
        .map((v) => ({ id: v.id, price: o.priceUsd ? Math.round(o.priceUsd * 100) : v.price, is_enabled: true })),
      print_areas: t.print_areas.map((a) => ({
        variant_ids: a.variant_ids,
        placeholders: a.placeholders
          .filter((p) => p.images.length)
          .map((p) => ({ position: p.position, images: [{ ...p.images[0], id: upload.id }] })),
      })),
    },
  });
  return product.id;
}

export async function publishProduct(productId: string) {
  const shop = await printifyShopId();
  await pf(`/shops/${shop}/products/${productId}/publish.json`, {
    method: "POST",
    json: { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true },
  });
  return `Published to Etsy (Printify product ${productId}). It appears on Etsy within a few minutes.`;
}

// Tommy's live products (not the TEMPLATE starting points), for the holiday refresh.
export async function listLiveProducts() {
  const shop = await printifyShopId();
  const d = await pf<{ data: Product[] }>(`/shops/${shop}/products.json?limit=50`);
  return d.data
    .filter((p) => !/^template/i.test(p.title) && (p.visible || p.external?.id))
    .map((p) => ({ id: p.id, title: p.title, description: p.description, tags: p.tags ?? [] }));
}

// Changes only the words of a listing (title, description, tags) and pushes just those to Etsy. Images, prices,
// variants, shipping and Etsy-side settings such as personalization are left alone.
export async function updateListingText(productId: string, t: { title: string; description: string; tags: string[] }) {
  const shop = await printifyShopId();
  await pf(`/shops/${shop}/products/${productId}.json`, {
    method: "PUT",
    json: { title: t.title.slice(0, 140), description: t.description, tags: t.tags.slice(0, 13) },
  });
  await pf(`/shops/${shop}/products/${productId}/publish.json`, {
    method: "POST",
    json: { title: true, description: true, images: false, variants: false, tags: true, keyFeatures: false, shipping_template: false },
  });
  return `Updated on Etsy: "${t.title.slice(0, 80)}". It shows within a few minutes.`;
}

export async function productMockup(productId: string): Promise<string | null> {
  const shop = await printifyShopId();
  const p = await pf<{ images?: { src: string; is_default: boolean }[] }>(`/shops/${shop}/products/${productId}.json`);
  return p.images?.find((i) => i.is_default)?.src ?? p.images?.[0]?.src ?? null;
}

export interface PrintifyOrder {
  id: string;
  status: string;
  created_at: string;
  total_price?: number; // cents
  total_shipping?: number; // cents
  metadata?: { shop_order_id?: string | number; shop_order_label?: string };
}

// The Printify order made from an Etsy order (Printify copies it over a few minutes after the sale).
export async function findOrderForEtsy(receiptId: number): Promise<PrintifyOrder | null> {
  const shop = await printifyShopId();
  const d = await pf<{ data: PrintifyOrder[] }>(`/shops/${shop}/orders.json?limit=50`);
  return d.data.find((o) => String(o.metadata?.shop_order_id ?? "") === String(receiptId) || String(o.metadata?.shop_order_label ?? "") === String(receiptId)) ?? null;
}

// Sends an order to production. Printify then charges the production + shipping cost to Tommy's Printify account.
export async function sendToProduction(orderId: string): Promise<string> {
  const shop = await printifyShopId();
  await pf(`/shops/${shop}/orders/${orderId}/send_to_production.json`, { method: "POST" });
  return `Sent to production in Printify (order ${orderId}). You'll get the tracking number when it ships.`;
}

// Orders that need a human: on hold, problems, unpaid.
export async function problemOrders() {
  const shop = await printifyShopId();
  const d = await pf<{ data: { id: string; status: string; created_at: string; metadata?: { shop_order_label?: string } }[] }>(`/shops/${shop}/orders.json?limit=50`);
  return d.data.filter((o) => ["on-hold", "has-issues", "payment-not-received", "canceled"].includes(o.status));
}
