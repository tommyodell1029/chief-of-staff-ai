"use client";
// Memories page: view, edit, confirm, or delete what Jarvis has learned.
import Link from "next/link";
import { useEffect, useState } from "react";

interface Memory {
  id: number;
  fact: string;
  category: string;
  source: string;
  createdAt: string | number;
  confirmed: boolean;
}

export default function MemoryManager() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unconfirmed">("all");
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState("general");

  const load = () =>
    fetch("/api/memories")
      .then((r) => r.json())
      .then((d) => setMemories(d.memories));

  useEffect(() => {
    load();
  }, []);

  const patch = async (id: number, changes: Partial<Memory>) => {
    const res = await fetch(`/api/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (res.ok) {
      const { memory } = await res.json();
      setMemories((ms) => ms?.map((m) => (m.id === id ? memory : m)) ?? null);
    }
  };

  const remove = async (m: Memory) => {
    if (!confirm(`Forget this?\n\n"${m.fact}"`)) return;
    await fetch(`/api/memories/${m.id}`, { method: "DELETE" });
    setMemories((ms) => ms?.filter((x) => x.id !== m.id) ?? null);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFact.trim()) return;
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fact: newFact, category: newCategory }),
    });
    setNewFact("");
    load();
  };

  const unconfirmed = memories?.filter((m) => !m.confirmed).length ?? 0;
  const shown = memories?.filter((m) => filter === "all" || !m.confirmed) ?? [];

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Memories</h1>
        <span className="ml-auto text-sm text-muted">{memories?.length ?? "…"} saved</span>
      </header>

      <p className="mb-4 text-sm text-muted">
        Facts Jarvis has learned about you. He reads all of these before every reply. New ones arrive{" "}
        <span className="text-warn">unconfirmed</span> — confirm the good ones, fix or delete the rest.
      </p>

      <form onSubmit={add} className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-line bg-panel p-3">
        <input
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          placeholder="Add a fact, e.g. Tommy's daughter is named…"
          className="min-w-0 flex-1 basis-64 rounded-lg border border-line bg-panel-2 px-3 py-2.5 outline-none focus:border-accent/70"
        />
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="w-32 rounded-lg border border-line bg-panel-2 px-3 py-2.5 outline-none focus:border-accent/70"
          aria-label="Category"
        />
        <button className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-30" disabled={!newFact.trim()}>
          Add
        </button>
      </form>

      <div className="mb-3 flex gap-2 text-sm">
        {(["all", "unconfirmed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 ${filter === f ? "border-accent text-accent" : "border-line text-muted"}`}
          >
            {f === "all" ? "All" : `Unconfirmed (${unconfirmed})`}
          </button>
        ))}
      </div>

      {memories === null ? (
        <p className="text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">
          Nothing here yet. Tell Jarvis something about yourself, like “Remember I’m a Yankees fan.”
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <MemoryRow key={m.id} m={m} onPatch={(c) => patch(m.id, c)} onDelete={() => remove(m)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemoryRow({ m, onPatch, onDelete }: { m: Memory; onPatch: (c: Partial<Memory>) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [fact, setFact] = useState(m.fact);
  const [category, setCategory] = useState(m.category);

  const save = () => {
    onPatch({ fact, category });
    setEditing(false);
  };

  return (
    <li className={`rounded-2xl border bg-panel p-3 ${m.confirmed ? "border-line" : "border-warn/40"}`}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            rows={2}
            className="rounded-lg border border-line bg-panel-2 px-3 py-2 outline-none focus:border-accent/70"
          />
          <div className="flex gap-2">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-36 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none"
            />
            <button onClick={save} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg px-3 py-2 text-sm text-muted">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p>{m.fact}</p>
            <p className="mt-1 text-xs text-muted">
              <span className="rounded bg-panel-2 px-1.5 py-0.5">{m.category}</span> · {m.source} ·{" "}
              {new Date(m.createdAt).toLocaleDateString()}
              {!m.confirmed && <span className="ml-1 text-warn">· unconfirmed</span>}
            </p>
          </div>
          <div className="flex gap-1 text-sm">
            {!m.confirmed && (
              <button onClick={() => onPatch({ confirmed: true })} className="rounded-lg border border-accent/50 px-3 py-1.5 text-accent">
                Confirm
              </button>
            )}
            <button onClick={() => setEditing(true)} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink">
              Edit
            </button>
            <button onClick={onDelete} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-danger">
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
