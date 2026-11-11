// GET /api/backup — downloads everything Jarvis knows as one .tar.gz: a consistent copy of the database
// (memories, to-dos, crews, approvals, leads, clients, settings and connected-account tokens) plus the media
// folder (Nina's images, voiceovers, reels). Used to keep a copy, or to move Jarvis to another computer.
// Signed-in only (like every page). Keys in Render's Environment are NOT included: copy those yourself.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getSqlite } from "@/lib/db";
import { mediaDir } from "@/lib/media";

export const dynamic = "force-dynamic";
const run = promisify(execFile);

export async function GET() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-backup-"));
  try {
    // SQLite's own backup makes a consistent copy even while Jarvis keeps running.
    await getSqlite().backup(path.join(dir, "jarvis.db"));
    const media = mediaDir();
    const stamp = new Date().toISOString().slice(0, 10);
    const out = path.join(dir, `jarvis-backup-${stamp}.tar.gz`);
    const { outboxDir } = await import("@/lib/outbox");
    const outbox = outboxDir();
    await run("tar", ["-czf", out, "-C", dir, "jarvis.db", "-C", path.dirname(media), path.basename(media), "-C", path.dirname(outbox), path.basename(outbox)], { timeout: 10 * 60_000 });
    const buf = fs.readFileSync(out);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="jarvis-backup-${stamp}.tar.gz"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
