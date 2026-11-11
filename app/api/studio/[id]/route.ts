// PATCH /api/studio/:id — edit caption/hashtags/image idea.
// POST /api/studio/:id {action: "approve" | "reject" | "regenerate" | "reel" | "shared"}.
import { publicBaseUrl } from "@/lib/publicUrl";
import { snoozePost } from "@/lib/nina/reminders";
import { approveContent, makeReel, markShared, recordPostDecision, regenerateImage, rejectContent, setResults, updateContent } from "@/lib/studio";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as { caption?: string; hashtags?: string; imagePrompt?: string; likes?: number; comments?: number; saves?: number };
  if (b.likes !== undefined || b.comments !== undefined || b.saves !== undefined) {
    const post = setResults(id, { likes: b.likes, comments: b.comments, saves: b.saves });
    return post ? Response.json({ post }) : Response.json({ error: "Not found" }, { status: 404 });
  }
  const changes: { caption?: string; hashtags?: string; imagePrompt?: string } = {};
  if (typeof b.caption === "string" && b.caption.trim()) changes.caption = b.caption.trim();
  if (typeof b.hashtags === "string") changes.hashtags = b.hashtags.trim();
  if (typeof b.imagePrompt === "string" && b.imagePrompt.trim()) changes.imagePrompt = b.imagePrompt.trim();
  const post = updateContent(id, changes);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ post });
}

export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (action === "approve") {
      recordPostDecision(id, true);
      return Response.json({ post: await approveContent(id, publicBaseUrl(req)) });
    }
    if (action === "reject") {
      recordPostDecision(id, false);
      return Response.json({ ok: rejectContent(id) ?? true });
    }
    if (action === "regenerate") return Response.json({ post: await regenerateImage(id) });
    if (action === "reel") return Response.json({ post: await makeReel(id) });
    if (action === "shared") return Response.json({ ok: markShared(id) ?? true });
    if (action === "later") return Response.json({ post: snoozePost(id) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
