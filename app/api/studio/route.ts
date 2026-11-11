// GET /api/studio — posts, Nina's persona and reference photos, and what's connected.
// POST /api/studio — {action:"create", …post} makes a post now; {action:"plan", count} asks the Content Planner for a batch.
import { createTask, findAgent } from "@/lib/crews/crews";
import { geminiConfigured } from "@/lib/integrations/gemini";
import { instagramConfigured } from "@/lib/integrations/instagram";
import { spendToday } from "@/lib/spend";
import { createPost, getPersona, getRefs, listContent, PLATFORMS, type Platform } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    posts: listContent(["draft", "approved", "failed", "posted"]).slice(0, 60),
    persona: getPersona(),
    refs: getRefs(),
    gemini: geminiConfigured(),
    instagram: instagramConfigured(),
    voice: !!process.env.NINA_VOICE_ID,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    count?: number;
    kind?: string;
    caption?: string;
    hashtags?: string;
    imagePrompt?: string;
    platforms?: string[];
  };
  const spend = spendToday();
  if (spend.overCap || spend.overMonthCap) return Response.json({ error: "Spending cap reached." }, { status: 402 });

  if (body.action === "plan" && body.kind === "ad") {
    const { business, agent } = findAgent("Nina", "UGC Ad Maker");
    if (!agent) return Response.json({ error: "Nina's UGC Ad Maker isn't set up yet. Restart Jarvis or set up your businesses first." }, { status: 400 });
    if (agent.status !== "active") return Response.json({ error: `Turn on the UGC Ad Maker in the ${business?.name} crew first.` }, { status: 400 });
    const n = Math.min(Math.max(body.count ?? 2, 1), 5);
    const task = createTask(
      agent.id,
      `Create ${n} UGC-style ads for the Etsy shop with create_post and ad: true. Pick products and angles that fit the next holiday or season and current trends. Each needs an image_prompt (the product in a cozy real-life scene), a caption in Nina's voice with a strong first line and 'link in bio', up to 5 hashtags, and posting notes. Follow your honesty rules: no claims Nina bought or uses it, no invented reviews. Never mention AI. SFW only.`,
      "tommy",
    );
    return Response.json({ task });
  }

  if (body.action === "plan") {
    const { business, agent } = findAgent("Nina", "Content Planner");
    if (!agent) return Response.json({ error: "Set up your businesses first (Command Center → Set up my 3 businesses)." }, { status: 400 });
    if (agent.status !== "active") return Response.json({ error: `Approve the ${business?.name} crew first.` }, { status: 400 });
    const n = Math.min(Math.max(body.count ?? 3, 1), 7);
    const task = createTask(
      agent.id,
      `Create ${n} Nina lifestyle posts for this week with create_post, like a real influencer's feed: mix Instagram photos and carousels with Reels/TikToks that have a voiceover. Base them on current trend hooks and audio. Each needs an image_prompt, caption, up to 5 hashtags (Instagram and TikTok's limit) and posting notes. Captions and hashtags never mention AI (Tommy turns on each platform's AI label instead). SFW only.`,
      "tommy",
    );
    return Response.json({ task });
  }

  if (body.action === "create") {
    const platforms = (body.platforms ?? ["instagram"]).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
    if (!body.caption?.trim() || !platforms.length) return Response.json({ error: "Caption and a platform are required." }, { status: 400 });
    const { business } = findAgent("Nina", "Content Planner");
    const item = await createPost(
      { platforms, caption: body.caption.trim(), hashtags: body.hashtags, imagePrompt: body.imagePrompt?.trim() || undefined },
      business?.id,
    );
    return Response.json({ post: item });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
