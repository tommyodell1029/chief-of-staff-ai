// Etsy order autopilot (the Order Desk). For every new paid Etsy order, Jarvis:
//   1. reads what was bought, the buyer's personalization and note;
//   2. checks any photo the buyer sent (size and print quality for the product);
//   3. finds the matching Printify order (Printify copies Etsy orders over by itself) and its cost;
//   4. puts one card in "Waiting on you": a ready-to-follow checklist, and, when the Printify order is on hold,
//      a one-tap "send to production" (which spends money, so it always waits for Tommy).
// Orders Printify already sent to production are just reported.
import { etsyConnected, etsyOrderDetails, type OrderDetail } from "@/lib/integrations/etsy";
import { findOrderForEtsy, printifyConfigured, type PrintifyOrder } from "@/lib/integrations/printify";
import { getSetting, setSetting } from "@/lib/settings";

const RETRY_HOURS = 6; // keep looking for the Printify copy this long

export interface PhotoCheck {
  url: string;
  ok: boolean;
  width?: number;
  height?: number;
  verdict: string;
}

// What size product a photo can print well on. Phone photos are usually 3000+ px on the long side.
export function photoVerdict(width: number, height: number, product: string): { ok: boolean; verdict: string } {
  const short = Math.min(width, height);
  const big = /blanket|canvas|poster|puzzle|tapestry|pillow|tote/i.test(product);
  if (short < 800) return { ok: false, verdict: `${width}×${height}: too small to print well. Ask the buyer for the original photo.` };
  if (big && short < 1600) return { ok: false, verdict: `${width}×${height}: fine for a mug or ornament, but may look soft on a ${product.toLowerCase().includes("blanket") ? "blanket" : "large print"}. Ask for a bigger copy if they have one.` };
  return { ok: true, verdict: `${width}×${height}: good for printing.` };
}

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

export async function checkPhoto(url: string, product: string): Promise<PhotoCheck> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return { url, ok: false, verdict: "Not an image Jarvis could open; check it in Etsy." };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 40_000_000) return { url, ok: true, verdict: "Very large file: plenty of detail." };
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    return { url, width: w, height: h, ...photoVerdict(w, h, product) };
  } catch (err) {
    return { url, ok: false, verdict: `Couldn't download it (${err instanceof Error ? err.message : String(err)}).` };
  }
}

// The written card for one order.
export function orderBrief(o: OrderDetail, photos: PhotoCheck[], pf: PrintifyOrder | null): { what: string; why: string } {
  const items = o.items
    .map((i) => {
      const opts = i.options.filter((x) => x.value).map((x) => `${x.name}: ${x.value}`);
      return `• ${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title.split(",")[0]}${opts.length ? `\n   ${opts.join("\n   ")}` : ""}`;
    })
    .join("\n");
  const photoLines = photos.length
    ? photos.map((p) => `${p.ok ? "✓" : "⚠"} Photo: ${p.verdict}`).join("\n")
    : "⚠ No photo link came through Etsy's data. Open the order in Etsy to see the buyer's photo and personalization.";
  const cost = pf?.total_price !== undefined ? ` · Printify cost $${((pf.total_price + (pf.total_shipping ?? 0)) / 100).toFixed(2)} incl. shipping` : "";
  const what = `Etsy order from ${o.buyer}: $${o.total.toFixed(2)}${cost}\n${items}${o.message ? `\nBuyer's note: "${o.message}"` : ""}\n${photoLines}`;
  const steps = [
    "Check the photo has no logos, cartoon characters or celebrities (rights).",
    pf ? "Open Printify → Orders, open this order and place the buyer's photo in the design (Edit)." : "",
    "Check the preview looks right.",
    pf ? "Then tap Approve here to send it to production (Printify charges the cost above)." : "",
  ].filter(Boolean);
  return { what, why: steps.map((s, i) => `${i + 1}. ${s}`).join("\n") };
}

interface Pending {
  id: number;
  firstSeen: number;
}

function pendingList(): Pending[] {
  try {
    return JSON.parse(getSetting("orderdesk:pending") ?? "[]") as Pending[];
  } catch {
    return [];
  }
}

// Runs every 15 minutes.
export async function runOrderDesk(now = Date.now()) {
  if (!etsyConnected()) return;
  const last = Number(getSetting("orderdesk:last") ?? 0);
  if (!last) {
    setSetting("orderdesk:last", String(Math.floor(now / 1000))); // start from now; don't process old orders
    return;
  }
  const fresh = await etsyOrderDetails(last - 6 * 3600); // look back a little: Printify may still be copying
  const pending = pendingList();
  for (const o of fresh) {
    if (o.at > last && !getSetting(`orderdesk:done:${o.id}`) && !pending.some((p) => p.id === o.id)) pending.push({ id: o.id, firstSeen: now });
  }
  if (fresh.length) setSetting("orderdesk:last", String(Math.max(last, ...fresh.map((o) => o.at))));

  const keep: Pending[] = [];
  for (const p of pending) {
    const o = fresh.find((x) => x.id === p.id);
    if (!o) {
      if (now - p.firstSeen < RETRY_HOURS * 3_600_000) keep.push(p);
      continue;
    }
    const pf = printifyConfigured() ? await findOrderForEtsy(o.id).catch(() => null) : null;
    if (printifyConfigured() && !pf && now - p.firstSeen < RETRY_HOURS * 3_600_000) {
      keep.push(p); // Printify hasn't copied it yet; try again next run
      continue;
    }
    await handleOrder(o, pf);
    setSetting(`orderdesk:done:${o.id}`, "1");
  }
  setSetting("orderdesk:pending", JSON.stringify(keep));
}

async function handleOrder(o: OrderDetail, pf: PrintifyOrder | null) {
  const product = o.items.map((i) => i.title).join(" ");
  const urls = [...new Set([...o.items.flatMap((i) => i.options.map((x) => x.value)), o.message].join(" ").match(URL_RE) ?? [])].slice(0, 5);
  const photos = await Promise.all(urls.map((u) => checkPhoto(u, product)));
  const { what, why } = orderBrief(o, photos, pf);
  const { createApproval } = await import("@/lib/crews/crews");
  const { notifyAll } = await import("@/lib/push");

  if (pf && ["pending", "in-production", "sending-to-production", "fulfilled", "shipped", "on-the-way"].includes(pf.status)) {
    await notifyAll({ title: "Etsy order is in production", body: `${o.buyer}'s order ($${o.total.toFixed(2)}) is already moving in Printify (${pf.status.replace(/-/g, " ")}).`, url: "/", station: false }).catch(() => {});
    return;
  }
  if (pf && ["on-hold", "has-issues", "draft"].includes(pf.status)) {
    createApproval({
      what,
      why,
      action: { type: "printify_production", orderId: pf.id, label: pf.metadata?.shop_order_label ?? String(o.id) },
    });
    return;
  }
  // No Printify order found (or Printify isn't connected): a checklist without the one-tap send.
  createApproval({
    what,
    why: `${why}\n${printifyConfigured() ? "Printify hasn't shown this order after 6 hours: check the Etsy–Printify connection." : "Printify isn't connected to Jarvis, so place the order in Printify yourself."} Approve to mark it handled.`,
  });
}
