// Weather from Google's Weather API, with Jarvis's one Google key (turn on "Weather API" for it in Google Cloud).
// One question = up to 3 calls (now, next 12 hours, next days), cached for 10 minutes per place.
// Capped by WEATHER_DAILY_LIMIT (default 60 calls a day), well inside Google's free monthly amount.
import { googleApiKey } from "./gemini";
import { geocode } from "./places";
import { getSetting, setSetting } from "@/lib/settings";

const API = "https://weather.googleapis.com/v1";

export const weatherConfigured = () => !!googleApiKey();

// "Here" is Tommy's home area (HOME_CITY / HOME_REGION, the same ones web search uses).
export const homePlace = () =>
  [process.env.HOME_CITY, process.env.HOME_REGION].filter(Boolean).join(", ") || kitCity() || "Jacksonville, FL";

// On a client's assistant, home is the city from their setup file.
function kitCity(): string {
  try {
    return process.env.KIT_MODE === "1" ? (JSON.parse(getSetting("kit_profile") || "{}") as { owner?: { city?: string } }).owner?.city ?? "" : "";
  } catch {
    return "";
  }
}

const dayKey = () => `weather_calls:${new Date().toISOString().slice(0, 10)}`;
const limit = () => Number(process.env.WEATHER_DAILY_LIMIT || 60);

async function call<T>(path: string, lat: number, lng: number, extra: Record<string, string> = {}): Promise<T> {
  const used = Number(getSetting(dayKey()) ?? 0);
  if (used >= limit()) throw new Error(`Daily weather limit reached (${limit()} calls).`);
  setSetting(dayKey(), String(used + 1));
  const qs = new URLSearchParams({ key: googleApiKey(), "location.latitude": String(lat), "location.longitude": String(lng), unitsSystem: "IMPERIAL", languageCode: "en", ...extra });
  const res = await fetch(`${API}${path}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (/not been used|disabled|PERMISSION_DENIED|blocked/i.test(msg + (data.error?.status ?? ""))) {
      throw new Error(`Google Weather: turn on "Weather API" for your Google key. Google said: ${msg}`);
    }
    throw new Error(`Google Weather: ${msg}`);
  }
  return data;
}

interface Temp {
  degrees?: number;
}
interface Cond {
  description?: { text?: string };
}
interface Precip {
  probability?: { percent?: number; type?: string };
}
interface Current {
  weatherCondition?: Cond;
  temperature?: Temp;
  feelsLikeTemperature?: Temp;
  relativeHumidity?: number;
  uvIndex?: number;
  precipitation?: Precip;
  thunderstormProbability?: number;
  wind?: { speed?: { value?: number }; gust?: { value?: number }; direction?: { cardinal?: string } };
  currentConditionsHistory?: { maxTemperature?: Temp; minTemperature?: Temp };
  timeZone?: { id?: string };
}
interface Hour {
  interval?: { startTime?: string };
  weatherCondition?: Cond;
  temperature?: Temp;
  precipitation?: Precip;
  thunderstormProbability?: number;
}
interface Half {
  weatherCondition?: Cond;
  precipitation?: Precip;
  thunderstormProbability?: number;
}
interface Day {
  displayDate?: { year: number; month: number; day: number };
  daytimeForecast?: Half;
  nighttimeForecast?: Half;
  maxTemperature?: Temp;
  minTemperature?: Temp;
  sunEvents?: { sunriseTime?: string; sunsetTime?: string };
}

const deg = (t?: Temp) => (typeof t?.degrees === "number" ? `${Math.round(t.degrees)}°F` : "?");
const pct = (p?: Precip) => p?.probability?.percent ?? 0;
const cond = (c?: Cond) => (c?.description?.text ?? "").toLowerCase() || "unknown";
const cardinal = (c?: string) => (c ? c.replace(/_/g, "-").toLowerCase() : "");

const cache = new Map<string, { at: number; text: string }>();

// A short, readable report for Jarvis: now, the next 12 hours, and the next few days.
export async function weatherReport(place?: string, days = 3): Promise<string> {
  const where = place?.trim() || homePlace();
  const n = Math.min(Math.max(days, 1), 10);
  const ck = `${where.toLowerCase()}|${n}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.text;

  const loc = await geocode(where);
  const tz = process.env.TZ || "America/New_York";
  const [now, hours, daily] = await Promise.all([
    call<Current>("/currentConditions:lookup", loc.lat, loc.lng),
    call<{ forecastHours?: Hour[] }>("/forecast/hours:lookup", loc.lat, loc.lng, { hours: "12", pageSize: "12" }).catch(() => ({ forecastHours: [] as Hour[] })),
    call<{ forecastDays?: Day[] }>("/forecast/days:lookup", loc.lat, loc.lng, { days: String(n), pageSize: String(n) }).catch(() => ({ forecastDays: [] as Day[] })),
  ]);
  const zone = now.timeZone?.id || tz;
  const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }) : "?");

  const lines: string[] = [`Weather for ${loc.name}:`];
  lines.push(
    `Now: ${cond(now.weatherCondition)}, ${deg(now.temperature)} (feels like ${deg(now.feelsLikeTemperature)}), humidity ${now.relativeHumidity ?? "?"}%, ` +
      `wind ${Math.round(now.wind?.speed?.value ?? 0)} mph ${cardinal(now.wind?.direction?.cardinal)}${now.wind?.gust?.value ? ` gusting ${Math.round(now.wind.gust.value)}` : ""}, ` +
      `rain chance ${pct(now.precipitation)}%, UV ${now.uvIndex ?? "?"}.`,
  );
  const hrs = hours.forecastHours ?? [];
  if (hrs.length) {
    const wet = hrs.filter((h) => pct(h.precipitation) >= 30 || (h.thunderstormProbability ?? 0) >= 30);
    lines.push(
      `Next 12 hours: ${hrs
        .filter((_, i) => i % 3 === 0)
        .map((h) => `${time(h.interval?.startTime)} ${deg(h.temperature)} ${cond(h.weatherCondition)} (${pct(h.precipitation)}% rain)`)
        .join("; ")}.` + (wet.length ? ` Rain most likely around ${wet.map((h) => time(h.interval?.startTime)).slice(0, 4).join(", ")}.` : " No rain expected."),
    );
  }
  for (const d of daily.forecastDays ?? []) {
    const date = d.displayDate ? new Date(Date.UTC(d.displayDate.year, d.displayDate.month - 1, d.displayDate.day, 12)) : null;
    const label = date ? date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }) : "?";
    const storm = Math.max(d.daytimeForecast?.thunderstormProbability ?? 0, d.nighttimeForecast?.thunderstormProbability ?? 0);
    lines.push(
      `${label}: high ${deg(d.maxTemperature)}, low ${deg(d.minTemperature)}; day ${cond(d.daytimeForecast?.weatherCondition)} (${pct(d.daytimeForecast?.precipitation)}% rain), ` +
        `night ${cond(d.nighttimeForecast?.weatherCondition)} (${pct(d.nighttimeForecast?.precipitation)}% rain)${storm >= 30 ? `, storms ${storm}%` : ""}; ` +
        `sunrise ${time(d.sunEvents?.sunriseTime)}, sunset ${time(d.sunEvents?.sunsetTime)}.`,
    );
  }
  const text = lines.join("\n");
  cache.set(ck, { at: Date.now(), text });
  return text;
}

// The next hour in the coming 3 with a real chance of rain or storms at home (one call), or null.
export async function rainSoon(): Promise<{ at: string; pct: number; storm: boolean } | null> {
  const loc = await geocode(homePlace());
  const d = await call<{ forecastHours?: Hour[] }>("/forecast/hours:lookup", loc.lat, loc.lng, { hours: "3", pageSize: "3" });
  const tz = process.env.TZ || "America/New_York";
  for (const h of d.forecastHours ?? []) {
    const pct = h.precipitation?.probability?.percent ?? 0;
    const storm = (h.thunderstormProbability ?? 0) >= 40;
    if (pct >= 60 || storm) {
      const at = h.interval?.startTime ? new Date(h.interval.startTime).toLocaleTimeString("en-US", { hour: "numeric", timeZone: tz }) : "soon";
      return { at, pct, storm };
    }
  }
  return null;
}

// Short spoken summaries for greetings and protocols. Today: "68 and clear, high of 81, rain likely this afternoon".
export async function weatherBrief(which: "today" | "tomorrow"): Promise<string | null> {
  if (!weatherConfigured()) return null;
  try {
    const loc = await geocode(homePlace());
    const days = await call<{ forecastDays?: Day[] }>("/forecast/days:lookup", loc.lat, loc.lng, { days: "2", pageSize: "2" });
    const d = days.forecastDays?.[which === "today" ? 0 : 1];
    if (!d) return null;
    const rain = Math.max(d.daytimeForecast?.precipitation?.probability?.percent ?? 0, d.nighttimeForecast?.precipitation?.probability?.percent ?? 0);
    const rainBit = rain >= 50 ? `, ${rain} percent chance of rain` : "";
    if (which === "tomorrow") {
      return `${cond(d.daytimeForecast?.weatherCondition)}, high of ${Math.round(d.maxTemperature?.degrees ?? 0)}, low of ${Math.round(d.minTemperature?.degrees ?? 0)}${rainBit}`;
    }
    const now = await call<Current>("/currentConditions:lookup", loc.lat, loc.lng);
    return `${Math.round(now.temperature?.degrees ?? 0)} and ${cond(now.weatherCondition)}, high of ${Math.round(d.maxTemperature?.degrees ?? 0)}${rainBit}`;
  } catch {
    return null;
  }
}
