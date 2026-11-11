// Uber ride links. Tommy checks the price and taps Confirm in Uber himself; Jarvis never books or pays (Uber's
// ride-booking API is limited to approved partners). Two link styles:
// - uber://?action=setPickup&… opens the Uber app directly with the trip filled in (phones).
// - https://m.uber.com/ul/?… the same trip as a web link (computers, or if the app isn't installed). On iPhone this
//   style only reaches the app when tapped in Safari, so phones use the uber:// link instead.
// Jarvis sends a link to his own /go/uber page, which opens the app and shows backups.
import { geocode } from "./places";

export interface Trip {
  lat: number;
  lng: number;
  name: string; // what Tommy called it, e.g. "the airport"
  addr: string;
  pickup?: { lat: number; lng: number; name: string; addr: string } | null; // null = current location
}

export async function planTrip(destination: string, pickup?: string, area?: string): Promise<Trip> {
  const where = (q: string) => (area && !/,/.test(q) ? `${q}, ${area}` : q);
  const to = await geocode(where(destination));
  let from: Trip["pickup"] = null;
  if (pickup && !/^(here|my location|current location|me)$/i.test(pickup.trim())) {
    const f = await geocode(where(pickup));
    from = { lat: f.lat, lng: f.lng, name: pickup.slice(0, 60), addr: f.name };
  }
  return { lat: to.lat, lng: to.lng, name: destination.slice(0, 60), addr: to.name, pickup: from };
}

function query(t: Trip): string {
  const p = new URLSearchParams({ action: "setPickup" });
  if (process.env.UBER_CLIENT_ID) p.set("client_id", process.env.UBER_CLIENT_ID);
  if (t.pickup) {
    p.set("pickup[latitude]", String(t.pickup.lat));
    p.set("pickup[longitude]", String(t.pickup.lng));
    p.set("pickup[nickname]", t.pickup.name);
    p.set("pickup[formatted_address]", t.pickup.addr);
  } else p.set("pickup", "my_location");
  p.set("dropoff[latitude]", String(t.lat));
  p.set("dropoff[longitude]", String(t.lng));
  p.set("dropoff[nickname]", t.name);
  p.set("dropoff[formatted_address]", t.addr);
  // Uber's examples write the brackets as-is (dropoff[latitude]).
  return p.toString().replace(/%5B/g, "[").replace(/%5D/g, "]");
}

export const appLink = (t: Trip) => `uber://?${query(t)}`;
export const webLink = (t: Trip) => `https://m.uber.com/ul/?${query(t)}`;

// Jarvis's own page for this trip (same site, so phone alerts and the app open it reliably).
export function goPath(t: Trip): string {
  const p = new URLSearchParams({ lat: String(t.lat), lng: String(t.lng), name: t.name, addr: t.addr });
  if (t.pickup) {
    p.set("plat", String(t.pickup.lat));
    p.set("plng", String(t.pickup.lng));
    p.set("pname", t.pickup.name);
    p.set("paddr", t.pickup.addr);
  }
  return `/go/uber?${p.toString()}`;
}

export function tripFromParams(q: Record<string, string | string[] | undefined>): Trip | null {
  const s = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const lat = Number(s("lat"));
  const lng = Number(s("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !s("lat")) return null;
  const plat = Number(s("plat"));
  const plng = Number(s("plng"));
  return {
    lat,
    lng,
    name: s("name").slice(0, 60) || "Destination",
    addr: s("addr").slice(0, 200),
    pickup: s("plat") && Number.isFinite(plat) && Number.isFinite(plng) ? { lat: plat, lng: plng, name: s("pname").slice(0, 60), addr: s("paddr").slice(0, 200) } : null,
  };
}
