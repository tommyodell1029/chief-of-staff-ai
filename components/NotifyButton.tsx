"use client";
// "Turn on alerts": asks this phone/iPad for permission and registers it for Jarvis notifications.
import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "needs-home-screen" | "blocked" | "off" | "on" | "working";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export default function NotifyButton() {
  const [state, setState] = useState<State>("loading");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator)) return setState("unsupported");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
      if (!("PushManager" in window) || !reg) {
        // iPhone/iPad only allow notifications for websites added to the Home Screen.
        return setState(isIOS() && !isInstalled() ? "needs-home-screen" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("blocked");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  const turnOn = async () => {
    setState("working");
    setHint(null);
    try {
      // Must be called straight from the tap, or iOS refuses to ask.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/push/subscribe").then((r) => r.json());
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) });
      const device = /iPhone/.test(navigator.userAgent) ? "iPhone" : isIOS() ? "iPad" : "Browser";
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), device }),
      });
      setState("on");
      await fetch("/api/push/test", { method: "POST" });
    } catch (err) {
      setState("off");
      setHint(err instanceof Error ? err.message : "Couldn't turn on alerts.");
    }
  };

  const turnOff = async () => {
    setState("working");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState("off");
  };

  if (state === "loading" || state === "unsupported") return null;

  const base = "rounded-lg border px-2.5 py-1.5 text-xs transition sm:px-3 sm:py-2 sm:text-sm";
  if (state === "needs-home-screen") {
    return (
      <button
        onClick={() => setHint("To get alerts on this device: tap Share → Add to Home Screen, then open Jarvis from the Home Screen icon and tap “Turn on alerts”.")}
        className={`${base} border-line text-muted hover:text-ink`}
      >
        Alerts
        {hint && <Hint text={hint} onClose={() => setHint(null)} />}
      </button>
    );
  }
  if (state === "blocked") {
    return (
      <button
        onClick={() => setHint("Notifications are blocked. iPhone: Settings → Notifications → Jarvis → Allow Notifications. Then reopen Jarvis.")}
        className={`${base} border-warn/40 text-warn`}
      >
        Alerts blocked
        {hint && <Hint text={hint} onClose={() => setHint(null)} />}
      </button>
    );
  }
  return (
    <span className="relative">
      <button
        onClick={state === "on" ? turnOff : turnOn}
        disabled={state === "working"}
        title={state === "on" ? "Alerts are on. Tap to turn them off on this device." : "Get briefings and to-do reminders on this device"}
        className={`${base} ${state === "on" ? "border-accent/50 text-accent" : "border-line text-muted hover:border-accent hover:text-ink"} disabled:opacity-50`}
      >
        {state === "on" ? "Alerts on" : state === "working" ? "…" : "Turn on alerts"}
      </button>
      {hint && <Hint text={hint} onClose={() => setHint(null)} />}
    </span>
  );
}

function Hint({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <span
      role="status"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="absolute right-0 top-full z-20 mt-2 block w-64 rounded-lg border border-line bg-panel-2 p-3 text-left text-xs leading-relaxed text-ink shadow-lg"
    >
      {text}
    </span>
  );
}
