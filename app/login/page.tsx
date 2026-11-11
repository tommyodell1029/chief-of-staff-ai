"use client";
import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Only same-site paths, so a link can't send you somewhere else after signing in.
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      return;
    }
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    setError(d.error ?? "Couldn't sign in.");
    setBusy(false);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6">
        <h1 className="mb-1 font-semibold tracking-[0.25em]">JARVIS</h1>
        <p className="mb-5 text-sm text-muted">Password, sir.</p>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded-xl border border-line bg-panel-2 px-3 py-3 text-base outline-none focus:border-accent/70"
        />
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <button
          disabled={!password || busy}
          className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-40"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
