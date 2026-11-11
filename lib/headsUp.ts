// Heads-ups Jarvis announces on the station without being asked (scheduler): meetings about to start, new Etsy
// orders, rain on the way. Each one is said once.
import { announce } from "@/lib/announce";
import { calendarConfigured, eventsBetween } from "@/lib/calendar";
import { etsyConnected, etsyOrdersSince } from "@/lib/integrations/etsy";
import { rainSoon, weatherConfigured } from "@/lib/integrations/weather";
import { getSetting, setSetting } from "@/lib/settings";

const once = (key: string) => {
  if (getSetting(key)) return false;
  setSetting(key, "1");
  return true;
};
const tz = () => process.env.TZ || "America/New_York";
const localHour = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "numeric", hour12: false }).format(new Date())) % 24;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: tz() });

// Every 5 minutes: events starting in the next 10-16 minutes.
export async function calendarHeadsUp() {
  if (!calendarConfigured()) return;
  const now = Date.now();
  const events = await eventsBetween(new Date(now + 10 * 60_000), new Date(now + 16 * 60_000));
  for (const e of events) {
    if (e.allDay || e.start.getTime() < now + 9 * 60_000) continue;
    if (!once(`headsup:cal:${e.start.getTime()}:${e.title}`)) continue;
    const mins = Math.round((e.start.getTime() - now) / 60_000);
    announce({
      kind: "calendar",
      text: `${e.title} in ${mins} min${e.location ? ` (${e.location})` : ""}`,
      say: `Sir, ${e.title} starts in ${mins} minutes${e.location ? `, at ${e.location}` : ""}.`,
    });
  }
}

// Every 15 minutes: new paid Etsy orders.
export async function etsyHeadsUp() {
  if (!etsyConnected()) return;
  const last = Number(getSetting("headsup:etsy:last") ?? 0);
  if (!last) {
    // First run: start from now, so old orders aren't announced.
    setSetting("headsup:etsy:last", String(Math.floor(Date.now() / 1000)));
    return;
  }
  const orders = (await etsyOrdersSince(last)).filter((o) => o.at > last); // never repeat an order
  if (!orders.length) return;
  setSetting("headsup:etsy:last", String(orders[0].at));
  if (orders.length === 1) {
    const o = orders[0];
    announce({ kind: "etsy", text: `New Etsy order: $${o.total.toFixed(2)}, ${o.items}`, say: `Sir, a new Etsy order just came in: ${o.items}, ${Math.round(o.total)} dollars.` });
  } else {
    const total = orders.reduce((s, o) => s + o.total, 0);
    announce({ kind: "etsy", text: `${orders.length} new Etsy orders, $${total.toFixed(2)}`, say: `Sir, ${orders.length} new Etsy orders came in, about ${Math.round(total)} dollars in all.` });
  }
}

// Hourly, 7 am-7 pm: rain or storms in the next few hours, once per day (and once more if storms).
export async function rainHeadsUp() {
  if (!weatherConfigured()) return;
  const h = localHour();
  if (h < 7 || h > 19) return;
  const r = await rainSoon();
  if (!r) return;
  if (!once(`headsup:rain:${today()}${r.storm ? ":storm" : ""}`)) return;
  announce({
    kind: "weather",
    text: `${r.storm ? "Storms" : "Rain"} likely around ${r.at} (${r.pct}%)`,
    say: r.storm
      ? `Sir, storms are likely around ${r.at}. You may want to plan around it.`
      : `Sir, rain is likely around ${r.at}. Worth grabbing an umbrella, or rolling up the truck windows.`,
  });
}
