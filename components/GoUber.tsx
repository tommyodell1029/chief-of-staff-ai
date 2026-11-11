"use client";
// Opens the Uber app with the trip filled in. On a phone it tries right away; the buttons are backups.
import Link from "next/link";
import { useEffect, useState } from "react";

export default function GoUber({ app, web, to, addr, from }: { app: string; web: string; to: string; addr: string; from: string }) {
  const [phone, setPhone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    setPhone(isPhone);
    if (isPhone) window.location.href = app; // opens the Uber app (iOS may ask "Open in Uber?")
  }, [app]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(addr || to);
      setCopied(true);
    } catch {}
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-sm font-semibold tracking-[0.3em] text-accent">UBER</h1>
      <p className="text-2xl">{to}</p>
      <p className="text-sm text-muted">
        {addr}
        <br />
        from {from}
      </p>
      <a href={phone ? app : web} className="rounded-2xl bg-accent px-5 py-4 text-center text-lg font-semibold text-bg">
        Open Uber with this trip
      </a>
      <a href={web} target="_blank" rel="noreferrer" className="rounded-2xl border border-line px-5 py-3 text-center text-sm text-muted">
        Use Uber&apos;s website instead
      </a>
      <button onClick={copy} className="rounded-2xl border border-line px-5 py-3 text-sm text-muted">
        {copied ? "Address copied ✓ (paste it into Uber's “Where to?”)" : "Copy the address"}
      </button>
      <p className="text-xs text-muted">You confirm the ride and price in Uber. Jarvis never books or pays.</p>
      <Link href="/" className="text-center text-xs text-muted">
        ← Back to Jarvis
      </Link>
    </div>
  );
}
