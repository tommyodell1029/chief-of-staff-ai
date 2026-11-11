// Google Maps search (Places API "Text Search", new version) with Jarvis's one Google key.
// The order of results is the order Google shows for that search, so #1–3 are roughly the map pack.
// Google gives about 1,000 of these searches free each month; Jarvis stops itself well below that
// (MAPS_DAILY_LIMIT, default 25 a day, and MAPS_MONTHLY_LIMIT, default 900), so it never runs up a bill.
import { googleApiKey } from "./gemini";
import { getSetting, setSetting } from "@/lib/settings";

const URL = "https://places.googleapis.com/v1/places:searchText";
// Only the fields we use. Ratings, website, hours and reviews put each search in Google's "Enterprise + Atmosphere" tier.
const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.reviews.publishTime",
  "places.photos.name",
].join(",");

export const mapsConfigured = () => !!googleApiKey();

const dailyLimit = () => Number(process.env.MAPS_DAILY_LIMIT || 25);
const monthlyLimit = () => Number(process.env.MAPS_MONTHLY_LIMIT || 900);

function counterKeys(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return { day: `maps_calls:${day}`, month: `maps_calls:${day.slice(0, 7)}` };
}

export function mapsUsage() {
  const k = counterKeys();
  return {
    today: Number(getSetting(k.day) ?? 0),
    month: Number(getSetting(k.month) ?? 0),
    dailyLimit: dailyLimit(),
    monthlyLimit: monthlyLimit(),
  };
}

function countCall() {
  const k = counterKeys();
  setSetting(k.day, String(Number(getSetting(k.day) ?? 0) + 1));
  setSetting(k.month, String(Number(getSetting(k.month) ?? 0) + 1));
}

export interface MapsPlace {
  rank: number; // position in Google's results for this search (1 = top)
  name: string;
  address: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number;
  latestReviewDaysAgo: number | null; // newest of the reviews Google returns (up to 5)
  category: string | null;
  hoursListed: boolean;
  photoCount: number; // Google returns up to 10
  mapsUrl: string | null;
  open: boolean; // false if Google marks it closed
}

interface RawPlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  reviews?: { publishTime?: string }[];
  photos?: unknown[];
}

const domainOf = (url?: string) =>
  url
    ? url
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split(/[/?#]/)[0] || null
    : null;

// Social pages and directories aren't the business's own website.
const NOT_A_SITE = /(facebook|instagram|yelp|linktr|google|business\.site|nextdoor|angi|homeadvisor|thumbtack|bbb)\./;

// One Google Maps search, e.g. "plumber in Jacksonville, FL". Up to 20 results, in Google's order.
export async function searchMaps(query: string, max = 20): Promise<MapsPlace[]> {
  if (!mapsConfigured()) throw new Error("Google Maps search needs GOOGLE_API_KEY (Connections page).");
  const u = mapsUsage();
  if (u.today >= u.dailyLimit) throw new Error(`Daily Google Maps search limit reached (${u.dailyLimit}). It resets tomorrow.`);
  if (u.month >= u.monthlyLimit) throw new Error(`Monthly Google Maps search limit reached (${u.monthlyLimit}), to stay inside Google's free amount.`);

  countCall(); // counted before the call so a failure can't loop past the limit
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleApiKey(), "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({ textQuery: query, pageSize: Math.min(Math.max(max, 1), 20), languageCode: "en", regionCode: "US" }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { places?: RawPlace[]; error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (/not been used|disabled|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED|blocked/i.test(msg + (data.error?.status ?? ""))) {
      throw new Error(`Google Maps: turn on "Places API (New)" for your Google key (see docs/connections-setup.md). Google said: ${msg}`);
    }
    throw new Error(`Google Maps: ${msg}`);
  }
  const now = Date.now();
  return (data.places ?? []).map((p, i) => {
    const times = (p.reviews ?? []).map((r) => (r.publishTime ? Date.parse(r.publishTime) : NaN)).filter((t) => !Number.isNaN(t));
    const domain = domainOf(p.websiteUri);
    return {
      rank: i + 1,
      name: p.displayName?.text ?? "?",
      address: p.formattedAddress ?? "",
      website: p.websiteUri ?? null,
      domain: domain && !NOT_A_SITE.test(domain) ? domain : null,
      phone: p.nationalPhoneNumber ?? null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? 0,
      latestReviewDaysAgo: times.length ? Math.round((now - Math.max(...times)) / 86_400_000) : null,
      category: p.primaryTypeDisplayName?.text ?? null,
      hoursListed: !!p.regularOpeningHours?.weekdayDescriptions?.length,
      photoCount: p.photos?.length ?? 0,
      mapsUrl: p.googleMapsUri ?? null,
      open: !p.businessStatus || p.businessStatus === "OPERATIONAL",
    };
  });
}

// A compact, readable version for agents.
export function describePlaces(query: string, places: MapsPlace[]): string {
  if (!places.length) return `Google Maps: no results for "${query}".`;
  const lines = places.map((p) => {
    const bits = [
      `#${p.rank} ${p.name}`,
      p.domain ? p.domain : p.website ? `site: ${p.website} (not their own domain)` : "no website",
      p.rating !== null ? `${p.rating}★ (${p.reviewCount} reviews)` : "no reviews",
      p.latestReviewDaysAgo !== null ? `newest review ${p.latestReviewDaysAgo}d ago` : "",
      p.hoursListed ? "" : "no hours listed",
      p.photoCount < 3 ? `${p.photoCount} photos` : "",
      p.category ?? "",
      p.address,
      p.open ? "" : "CLOSED",
    ].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  });
  return `Google Maps results for "${query}" (in Google's order; #1–3 ≈ the map pack):\n${lines.join("\n")}`;
}

// Turns a place name ("Jacksonville, FL", "Orange Park") into coordinates, for weather. Uses one Maps search the
// first time (it counts toward the same caps) and is remembered after that, so each place is looked up only once.
export async function geocode(place: string): Promise<{ lat: number; lng: number; name: string }> {
  const key = `geo:${place.trim().toLowerCase()}`;
  const cached = getSetting(key);
  if (cached) return JSON.parse(cached);
  if (!mapsConfigured()) throw new Error("Needs GOOGLE_API_KEY.");
  const u = mapsUsage();
  if (u.today >= u.dailyLimit || u.month >= u.monthlyLimit) throw new Error("Google Maps search limit reached for now.");
  countCall();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleApiKey(), "X-Goog-FieldMask": "places.location,places.formattedAddress" },
    body: JSON.stringify({ textQuery: place, pageSize: 1, languageCode: "en", regionCode: "US" }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { places?: { location?: { latitude: number; longitude: number }; formattedAddress?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Google Maps: ${data.error?.message ?? `HTTP ${res.status}`}`);
  const p = data.places?.[0];
  if (!p?.location) throw new Error(`Couldn't find "${place}" on Google Maps.`);
  const out = { lat: p.location.latitude, lng: p.location.longitude, name: p.formattedAddress ?? place };
  setSetting(key, JSON.stringify(out));
  return out;
}

