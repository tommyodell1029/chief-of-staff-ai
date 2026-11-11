"use client";
// To-dos page: everything on Tommy's list. Jarvis adds and completes items by voice; this page does the rest.
import Link from "next/link";
import { useEffect, useState } from "react";
import { dueLabel, type TodoInfo } from "./TodayBar";

export default function TodoManager() {
  const [todos, setTodos] = useState<TodoInfo[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const load = () =>
    fetch("/api/todos")
      .then((r) => r.json())
      .then((d) => setTodos(d.todos));

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // datetime-local has no time zone; new Date() reads it as this device's local time.
      body: JSON.stringify({ title, dueAt: due ? new Date(due).toISOString() : null }),
    });
    setTitle("");
    setDue("");
    load();
  };

  const toggle = async (t: TodoInfo) => {
    await fetch(`/api/todos/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !t.done }),
    });
    load();
  };

  const remove = async (t: TodoInfo) => {
    if (!confirm(`Delete "${t.title}"?`)) return;
    await fetch(`/api/todos/${t.id}`, { method: "DELETE" });
    load();
  };

  const open = todos?.filter((t) => !t.done) ?? [];
  const done = todos?.filter((t) => t.done) ?? [];

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">To-dos</h1>
        <span className="ml-auto text-sm text-muted">{todos ? `${open.length} open` : "…"}</span>
      </header>

      <p className="mb-4 text-sm text-muted">
        Tell Jarvis “remind me to…” or “add … to my list”, and say “I finished …” to tick things off. You can also manage
        the list here.
      </p>

      <form onSubmit={add} className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-line bg-panel p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a to-do…"
          className="min-w-0 flex-1 basis-64 rounded-lg border border-line bg-panel-2 px-3 py-2.5 outline-none focus:border-accent/70"
        />
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due (optional)"
          className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-muted outline-none focus:border-accent/70"
        />
        <button
          disabled={!title.trim()}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-30"
        >
          Add
        </button>
      </form>

      {todos === null ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <List items={open} onToggle={toggle} onDelete={remove} empty="Nothing open. Nicely done, sir." />
          {done.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold tracking-wide text-muted">Recently done</h2>
              <List items={done} onToggle={toggle} onDelete={remove} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function List({
  items,
  onToggle,
  onDelete,
  empty,
}: {
  items: TodoInfo[];
  onToggle: (t: TodoInfo) => void;
  onDelete: (t: TodoInfo) => void;
  empty?: string;
}) {
  if (items.length === 0 && empty) {
    return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((t) => {
        const due = dueLabel(t.dueAt);
        return (
          <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-3">
            <button
              onClick={() => onToggle(t)}
              aria-label={t.done ? "Mark not done" : "Mark done"}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm ${
                t.done ? "border-accent bg-accent text-bg" : "border-accent/60 hover:bg-accent/20"
              }`}
            >
              {t.done ? "✓" : ""}
            </button>
            <div className="min-w-0 flex-1">
              <p className={t.done ? "text-muted line-through" : ""}>{t.title}</p>
              {due && !t.done && (
                <p className={`text-xs ${due.overdue ? "text-warn" : "text-muted"}`}>
                  {due.overdue ? "Overdue · " : "Due "}
                  {due.text}
                </p>
              )}
            </div>
            <button onClick={() => onDelete(t)} className="rounded-lg px-2 py-1 text-sm text-muted hover:text-danger">
              Delete
            </button>
          </li>
        );
      })}
    </ul>
  );
}
