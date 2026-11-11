"use client";
// Edit the About Tommy profile that Jarvis reads before every reply.
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AboutPage() {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/about")
      .then((r) => r.json())
      .then((d) => setText(d.text));
  }, []);

  const save = async () => {
    setSaved("saving");
    const res = await fetch("/api/about", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setSaved(res.ok ? "saved" : "error");
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col p-4">
      <header className="mb-3 flex items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">About Tommy</h1>
        <button
          onClick={save}
          disabled={text === null || saved === "saving"}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
        >
          {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved ✓" : "Save"}
        </button>
      </header>
      <p className="mb-3 text-sm text-muted">
        Jarvis reads this whole profile before every reply. Paste in your work, schedule, family, goals and skills, and how
        you like to be talked to.
        {saved === "error" && <span className="ml-1 text-danger">Couldn&apos;t save. Try again.</span>}
      </p>
      <textarea
        value={text ?? "Loading…"}
        disabled={text === null}
        onChange={(e) => {
          setText(e.target.value);
          setSaved("idle");
        }}
        className="min-h-[60dvh] flex-1 rounded-2xl border border-line bg-panel p-4 font-mono text-sm leading-relaxed outline-none focus:border-accent/70"
      />
    </div>
  );
}
