// The Outbox: everything the crews finished, in one place to open or download. Agents can also save files here
// (save_file): reports, lead lists, scripts. Other finished work (crew results, walk-in audits, Nina's reels and
// images) is listed straight from where it already lives.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getDb, schema } from "@/lib/db";
import type { Agent, Task } from "@/lib/db/schema";
import { dataDir } from "@/lib/paths";

const EXT = /\.(md|csv|txt)$/i;
const MAX_BYTES = 500_000;

export function outboxDir(): string {
  const dir = path.join(dataDir(), "outbox");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeFileName(name: string): string {
  name = name.split(/[\\/]/).pop() ?? "file"; // never a folder path
  const base = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  const ext = (name.match(EXT)?.[1] ?? "md").toLowerCase();
  return `${base}-${randomBytes(3).toString("hex")}.${ext}`;
}

export function saveToOutbox(o: { title: string; filename: string; content: string; agentId?: number; taskId?: number }) {
  if (Buffer.byteLength(o.content) > MAX_BYTES) throw new Error("That file is too big for the Outbox (500 KB max).");
  const file = safeFileName(o.filename);
  fs.writeFileSync(path.join(outboxDir(), file), o.content);
  return getDb()
    .insert(schema.outboxItems)
    .values({ title: o.title.slice(0, 140), file, agentId: o.agentId ?? null, taskId: o.taskId ?? null, createdAt: new Date() })
    .returning()
    .get();
}

export function readOutboxFile(id: number): { name: string; type: string; body: Buffer } | null {
  const item = getDb().select().from(schema.outboxItems).where(eq(schema.outboxItems.id, id)).get();
  if (!item || !/^[a-z0-9-]+\.(md|csv|txt)$/.test(item.file)) return null;
  try {
    const body = fs.readFileSync(path.join(outboxDir(), item.file));
    const type = item.file.endsWith(".csv") ? "text/csv" : item.file.endsWith(".md") ? "text/markdown" : "text/plain";
    return { name: item.file, type: `${type}; charset=utf-8`, body };
  } catch {
    return null;
  }
}

// The save_file tool every crew agent gets.
export function saveFileTool(agent: Agent, task: Task) {
  return betaZodTool({
    name: "save_file",
    description:
      "Save a finished deliverable to Tommy's Outbox as a file he can open or download: a report (.md), a list or table (.csv), or plain text (.txt). Use it for anything he'd want to keep or reuse, like lead lists, scripts, plans or audits.",
    inputSchema: z.object({
      title: z.string().max(140).describe("Short title Tommy sees, e.g. 'Orange Park roofers: 12 leads'"),
      filename: z.string().describe("e.g. 'orange-park-roofers.csv' (.md, .csv or .txt)"),
      content: z.string().describe("The full file contents"),
    }),
    run: async ({ title, filename, content }) => {
      try {
        const item = saveToOutbox({ title, filename, content, agentId: agent.id, taskId: task.id });
        return `Saved to the Outbox as "${item.title}".`;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
  });
}

export type OutboxEntry = {
  kind: "file" | "result" | "audit" | "post";
  id: number;
  title: string;
  by: string | null;
  at: string;
  preview: string;
  open: string; // link to view
  download?: string; // link to download
};

// Everything finished in the last 30 days, newest first.
export function listOutbox(kind?: OutboxEntry["kind"]): OutboxEntry[] {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const agents = new Map(db.select().from(schema.agents).all().map((a) => [a.id, a.name]));
  const out: OutboxEntry[] = [];

  if (!kind || kind === "file") {
    for (const f of db.select().from(schema.outboxItems).where(gte(schema.outboxItems.createdAt, since)).orderBy(desc(schema.outboxItems.createdAt)).all()) {
      out.push({ kind: "file", id: f.id, title: f.title, by: f.agentId ? (agents.get(f.agentId) ?? null) : null, at: f.createdAt.toISOString(), preview: f.file, open: `/api/outbox/file/${f.id}`, download: `/api/outbox/file/${f.id}?download=1` });
    }
  }
  if (!kind || kind === "result") {
    for (const t of db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.status, "done"), gte(schema.tasks.createdAt, since)))
      .orderBy(desc(schema.tasks.finishedAt))
      .limit(80)
      .all()) {
      if (!t.result?.trim()) continue;
      out.push({
        kind: "result",
        id: t.id,
        title: t.instructions.split("\n")[0].replace(/^Handed over by [^:]+:\s*/, "").slice(0, 120),
        by: t.agentId ? (agents.get(t.agentId) ?? null) : null,
        at: (t.finishedAt ?? t.createdAt).toISOString(),
        preview: (t.review ?? t.result).slice(0, 240),
        open: `/api/outbox/task/${t.id}`,
        download: `/api/outbox/task/${t.id}?download=1`,
      });
    }
  }
  if (!kind || kind === "audit") {
    for (const a of db.select().from(schema.audits).where(gte(schema.audits.createdAt, since)).orderBy(desc(schema.audits.createdAt)).all()) {
      out.push({ kind: "audit", id: a.id, title: `Walk-in audit: ${a.business}`, by: "Audit", at: a.createdAt.toISOString(), preview: a.city, open: `/audit/${a.id}` });
    }
  }
  if (!kind || kind === "post") {
    for (const p of db
      .select()
      .from(schema.contentItems)
      .where(and(inArray(schema.contentItems.status, ["approved", "posted"]), gte(schema.contentItems.createdAt, since)))
      .orderBy(desc(schema.contentItems.createdAt))
      .all()) {
      const file = p.videoFile ?? p.imageFile;
      if (!file) continue;
      out.push({ kind: "post", id: p.id, title: `Nina ${p.videoFile ? "reel" : "post"}: ${p.caption.split("\n")[0].slice(0, 80)}`, by: "Nina Studio", at: p.createdAt.toISOString(), preview: p.caption.slice(0, 200), open: `/api/media/${file}`, download: `/api/media/${file}` });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
}
