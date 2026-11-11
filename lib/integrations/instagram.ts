// Instagram publishing (official API, "Instagram API with Instagram Login"). Free; needs a Creator/Business account.
// IG_ACCESS_TOKEN is a long-lived token (60 days); Jarvis refreshes it weekly and keeps the newest copy.
import { getSetting, setSetting } from "@/lib/settings";

const GRAPH = `https://graph.instagram.com/${process.env.IG_API_VERSION || "v23.0"}`;

export function instagramConfigured(): boolean {
  return !!(getSetting("ig_token") || process.env.IG_ACCESS_TOKEN);
}

const token = () => getSetting("ig_token") || process.env.IG_ACCESS_TOKEN || "";

async function ig<T>(path: string, params: Record<string, string> = {}, method = "GET"): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token() });
  const res = await fetch(`${GRAPH}${path}${method === "GET" ? `?${qs}` : ""}`, {
    method,
    body: method === "POST" ? qs : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Instagram: ${data.error?.message ?? res.status}`);
  return data;
}

export async function instagramAccount() {
  return ig<{ user_id: string; username: string }>("/me", { fields: "user_id,username" });
}

// Publishes one image post. imageUrl must be a public https JPEG (Jarvis uses a signed link).
export async function publishImage(imageUrl: string, caption: string): Promise<string> {
  const me = await instagramAccount();
  const container = await ig<{ id: string }>(`/${me.user_id}/media`, { image_url: imageUrl, caption }, "POST");
  for (let i = 0; i < 20; i++) {
    const s = await ig<{ status_code?: string }>(`/${container.id}`, { fields: "status_code" });
    if (s.status_code === "FINISHED" || !s.status_code) break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the image (${s.status_code}).`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const post = await ig<{ id: string }>(`/${me.user_id}/media_publish`, { creation_id: container.id }, "POST");
  const info = await ig<{ permalink?: string }>(`/${post.id}`, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return info.permalink ?? `https://www.instagram.com/${me.username}/`;
}

// Publishes a Reel. videoUrl must be a public https MP4 (H.264/AAC, 9:16). Instagram downloads and processes it,
// which can take a minute or two.
export async function publishReel(videoUrl: string, caption: string): Promise<string> {
  const me = await instagramAccount();
  const container = await ig<{ id: string }>(`/${me.user_id}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }, "POST");
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const s = await ig<{ status_code?: string; status?: string }>(`/${container.id}`, { fields: "status_code,status" });
    if (s.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the reel (${s.status ?? s.status_code}).`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!ready) throw new Error("Instagram is still processing the reel after 5 minutes. Try Approve again in a bit.");
  const post = await ig<{ id: string }>(`/${me.user_id}/media_publish`, { creation_id: container.id }, "POST");
  const info = await ig<{ permalink?: string }>(`/${post.id}`, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return info.permalink ?? `https://www.instagram.com/${me.username}/reels/`;
}

export interface IgPost {
  id: string;
  caption: string;
  timestamp: string;
  likes: number;
  comments: number;
  saves: number | null; // needs the insights permission; null without it
  shares: number | null;
  permalink: string;
  type: string;
}

// Nina's recent posts with their engagement. Saves and shares come from insights when the token allows it.
export async function recentPosts(limit = 30): Promise<IgPost[]> {
  const me = await instagramAccount();
  const d = await ig<{ data: { id: string; caption?: string; timestamp: string; like_count?: number; comments_count?: number; permalink: string; media_type: string }[] }>(`/${me.user_id}/media`, {
    fields: "id,caption,timestamp,like_count,comments_count,permalink,media_type",
    limit: String(limit),
  });
  return Promise.all(
    d.data.map(async (m) => {
      const ins = await ig<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`/${m.id}/insights`, { metric: "saved,shares" }).catch(() => null);
      const val = (n: string) => {
        const x = ins?.data.find((i) => i.name === n);
        return x ? (x.total_value?.value ?? x.values?.[0]?.value ?? 0) : null;
      };
      return {
        id: m.id,
        caption: m.caption ?? "",
        timestamp: m.timestamp,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        saves: val("saved"),
        shares: val("shares"),
        permalink: m.permalink,
        type: m.media_type,
      };
    }),
  );
}

// Long-lived tokens last 60 days; refreshing resets the clock. Run weekly by the scheduler.
export async function refreshInstagramToken() {
  if (!instagramConfigured()) return;
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token())}`);
  const data = (await res.json()) as { access_token?: string; error?: { message?: string } };
  if (data.access_token) setSetting("ig_token", data.access_token);
  else console.error("[instagram] token refresh failed:", data.error?.message);
}
