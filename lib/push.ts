// Phone notifications (Web Push). Works on iPhone/iPad (iOS 16.4+) once Jarvis is added to the Home Screen.
import { holdForMorning } from "@/lib/nightshift";
import { personalize } from "@/lib/kit/kit";
import { announce, type AnnounceKind } from "@/lib/announce";
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { dataDir } from "@/lib/paths";

// The key pair that proves notifications really come from this Jarvis. Created once and kept next to the
// database, so there's nothing to set up. (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in settings override it.)
function keys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(dataDir(), "vapid.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const generated = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(generated), { mode: 0o600 });
    return generated;
  }
}

let configured = false;
function configure() {
  if (configured) return;
  const { publicKey, privateKey } = keys();
  // Apple requires a contact address in this field; it's sent to Apple's push service, not shown to anyone.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:jarvis@example.com", publicKey, privateKey);
  configured = true;
}

export function publicKey(): string {
  return keys().publicKey;
}

export function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device?: string) {
  getDb()
    .insert(schema.pushSubscriptions)
    .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, device },
    })
    .run();
}

export function removeSubscription(endpoint: string) {
  getDb().delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).run();
}

export function subscriptionCount(): number {
  return getDb().select().from(schema.pushSubscriptions).all().length;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string; // page to open when tapped
  tag?: string; // a newer notification with the same tag replaces the older one
  say?: string; // what the station says out loud (default: title + body)
  station?: boolean; // false = phone only, not announced on the station
  kind?: AnnounceKind;
}

// Send to every device that turned notifications on. Devices that switched them off are forgotten.
export async function notifyAll(msg: PushMessage): Promise<number> {
  // During a Night Shift, alerts that would wake Tommy wait for the morning report.
  if (holdForMorning(msg.tag)) return 0;
  msg = { ...msg, title: personalize(msg.title), body: personalize(msg.body), say: msg.say === undefined ? undefined : personalize(msg.say) };
  if (msg.station !== false) {
    try {
      announce({ kind: msg.kind ?? (msg.tag === "briefing" ? "briefing" : "alert"), text: `${msg.title}: ${msg.body}`, say: msg.say ?? `${msg.title}. ${msg.body}` });
    } catch (err) {
      console.error("[announce]", err);
    }
  }
  import("@/lib/integrations/telegram")
    .then((t) => t.telegramAlert(msg))
    .catch((err) => console.error("[telegram]", err));
  const subs = getDb().select().from(schema.pushSubscriptions).all();
  if (subs.length === 0) return 0;
  configure();
  const payload = JSON.stringify({ ...msg, body: msg.body.slice(0, 240) });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 6 * 3600,
          urgency: "normal",
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) removeSubscription(s.endpoint);
        else console.error("[push] send failed:", status ?? err);
      }
    }),
  );
  return sent;
}
