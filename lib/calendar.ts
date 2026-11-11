// Read-only Google Calendar. Uses Tommy's Google sign-in when it's connected (all his calendars);
// otherwise the calendar's private iCal address (GOOGLE_CALENDAR_ICS_URL).
import ical, { type CalendarResponse, type VEvent } from "node-ical";
import { accessToken, gmailConnected, googleScopes } from "@/lib/integrations/gmail";

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
}

let cache: { at: number; events: CalendarResponse } | null = null;
const CACHE_MS = 10 * 60_000;

const viaGoogle = () => gmailConnected() && googleScopes().includes("calendar");

export function calendarConfigured(): boolean {
  return viaGoogle() || !!process.env.GOOGLE_CALENDAR_ICS_URL;
}

// Google Calendar API: every calendar Tommy has selected, recurring events already expanded.
async function googleEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const token = await accessToken();
  const get = async <T,>(url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const d = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Google Calendar: ${d.error?.message ?? res.status}`);
    return d;
  };
  const cals = await get<{ items: { id: string; selected?: boolean }[] }>("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  const out: CalendarEvent[] = [];
  for (const cal of cals.items.filter((c) => c.selected !== false)) {
    const qs = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
    const ev = await get<{
      items: { status?: string; summary?: string; location?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }[];
    }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${qs}`);
    for (const e of ev.items) {
      if (e.status === "cancelled") continue;
      const allDay = !e.start.dateTime;
      out.push({
        title: e.summary ?? "(no title)",
        // All-day dates are calendar days: read them as local midnight.
        start: new Date(e.start.dateTime ?? `${e.start.date}T00:00:00`),
        end: new Date(e.end.dateTime ?? `${e.end.date}T00:00:00`),
        allDay,
        location: e.location || undefined,
      });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

async function load(): Promise<CalendarResponse> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.events;
  const res = await fetch(process.env.GOOGLE_CALENDAR_ICS_URL!, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Calendar download failed (${res.status})`);
  const events = ical.sync.parseICS(await res.text());
  cache = { at: Date.now(), events };
  return events;
}

const text = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as { val: unknown }).val) : "";

// Events overlapping [from, to], recurring events expanded, sorted by start time.
export async function eventsBetween(from: Date, to: Date): Promise<CalendarEvent[]> {
  if (viaGoogle()) return googleEvents(from, to);
  const out: CalendarEvent[] = [];
  for (const component of Object.values(await load())) {
    if (!component || (component as { type?: string }).type !== "VEVENT") continue;
    const item = component as VEvent;
    if (item.status === "CANCELLED") continue;
    if (item.rrule) {
      for (const inst of ical.expandRecurringEvent(item, { from, to, expandOngoing: true })) {
        out.push({
          title: text(inst.summary),
          start: new Date(inst.start),
          end: new Date(inst.end),
          allDay: inst.isFullDay,
          location: text(item.location) || undefined,
        });
      }
    } else if (!item.recurrenceid) {
      const start = new Date(item.start);
      const end = item.end ? new Date(item.end) : start;
      if (end >= from && start <= to) {
        out.push({
          title: text(item.summary),
          start,
          end,
          allDay: item.datetype === "date",
          location: text(item.location) || undefined,
        });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function describeEvent(e: CalendarEvent): string {
  const tz = process.env.TZ || undefined;
  const day = e.start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const when = e.allDay
    ? `${day} (all day)`
    : `${day} ${e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}–${e.end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}`;
  return `${when}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
}
