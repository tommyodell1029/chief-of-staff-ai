// Business tiles with Stripe and Etsy sales folded in. Stripe money counts toward the business that bills
// through Stripe: LaunchPad Local by default (STRIPE_BUSINESS = part of another business's name to change it).
import { AGENCY_NAME } from "@/config/business";
import { businessTiles } from "@/lib/crews/crews";
import { etsyConnected, etsySummary } from "@/lib/integrations/etsy";
import { stripeConfigured, stripeSummary } from "@/lib/integrations/stripe";

export async function tilesWithStripe() {
  const tiles = businessTiles();
  // Etsy and Stripe are asked at the same time, and the page doesn't wait more than 2.5 s for either: a slow
  // answer is left out this time and is cached (10 / 5 minutes) for the next load.
  const within = <T,>(p: Promise<T>) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
  const [e, s] = await Promise.all([etsyConnected() ? within(etsySummary()) : null, stripeConfigured() ? within(stripeSummary()) : null]);
  // Etsy sales count toward the POD store.
  const pod = tiles.find((x) => /etsy|pod|photo gift/i.test(x.name));
  if (e && pod) pod.moneyThisWeek += e.weekUsd;
  if (!s) return tiles;
  const match = (process.env.STRIPE_BUSINESS || AGENCY_NAME).toLowerCase();
  const t = tiles.find((x) => x.name.toLowerCase().includes(match));
  if (t) {
    t.moneyThisWeek += s.weekUsd;
    t.mrr = (t.mrr ?? 0) + s.mrrUsd;
  }
  return tiles;
}
