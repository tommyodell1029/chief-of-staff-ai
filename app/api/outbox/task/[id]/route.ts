// GET /api/outbox/task/:id[?download=1] — a crew agent's finished result as a Markdown file.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const t = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  if (!t || t.status !== "done" || !t.result) return new Response("Not found", { status: 404 });
  const agent = t.agentId ? db.select().from(schema.agents).where(eq(schema.agents.id, t.agentId)).get() : undefined;
  const when = (t.finishedAt ?? t.createdAt).toLocaleString("en-US", { timeZone: process.env.TZ || "America/New_York" });
  const md = `# ${agent?.name ?? "Crew"}: result\n\n_${when}_\n\n## Task\n\n${t.instructions}\n\n## Result\n\n${t.result}\n${t.review ? `\n## Jarvis's review\n\n${t.review}\n` : ""}`;
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = `${(agent?.name ?? "crew").toLowerCase().replace(/\W+/g, "-")}-task-${t.id}.md`;
  return new Response(md, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
