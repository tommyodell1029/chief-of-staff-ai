"use client";
// The Outbox: everything the crews finished, in one place to read or download.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Markdown from "./Markdown";

interface Entry {
  kind: "file" | "result" | "audit" | "post";
  id: number;
  title: string;
  by: string | null;
  at: string;
  preview: string;
  open: string;
  download?: string;
}

const KINDS: { id: Entry["kind"] | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "file", label: "Files" },
  { id: "result", label: "Crew results" },
  { id: "audit", label: "Audits" },
  { id: "post", label: "Nina" },
];
const ICON: Record<Entry["kind"], string> = { file: "📄", result: "✅", audit: "🗺️", post: "🎬" };

export default function Outbox() {
  const [kind, setKind] = useState<Entry["kind"] | "all">("all");
  const [items, setItems] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<{ key: string; text: string } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/outbox${kind === "all" ? "" : `?kind=${kind}`}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, [kind]);
  useEffect(() => load(), [load]);

  const toggle = async (e: Entry) => {
    const key = `${e.kind}-${e.id}`;
    if (open?.key === key) return setOpen(null);
    if (e.kind === "audit" || e.kind === "post") return window.open(e.open, "_blank");
    const text = await fetch(e.open).then((r) => (r.ok ? r.text() : "Couldn't open it."));
    setOpen({ key, text });
  };

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Outbox</h1>
      </header>
      <p className="mb-3 text-sm text-muted">Everything your crews finished in the last 30 days: files they saved, their results, walk-in audits and Nina&apos;s media.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => {
              setKind(k.id);
              setOpen(null);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${kind === k.id ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {items && items.length === 0 && <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">Nothing here yet. Finished work shows up as the crews complete it.</p>}
      <ul className="space-y-2">
        {items?.map((e) => {
          const key = `${e.kind}-${e.id}`;
          return (
            <li key={key} className="rounded-2xl border border-line bg-panel p-3 text-sm">
              <button onClick={() => toggle(e)} className="flex w-full items-start gap-2 text-left">
                <span aria-hidden>{ICON[e.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{e.title}</span>
                  <span className="block text-xs text-muted">
                    {e.by ? `${e.by} · ` : ""}
                    {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  {open?.key !== key && <span className="mt-1 line-clamp-2 block text-xs text-muted">{e.preview}</span>}
                </span>
              </button>
              {open?.key === key && (
                <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg bg-panel-2 p-3">
                  {e.open.includes(".csv") || e.preview.endsWith(".csv") ? <pre className="whitespace-pre-wrap text-xs">{open.text}</pre> : <Markdown text={open.text} />}
                </div>
              )}
              {e.download && (
                <div className="mt-2 flex gap-2">
                  <a href={e.download} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">
                    Download
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
