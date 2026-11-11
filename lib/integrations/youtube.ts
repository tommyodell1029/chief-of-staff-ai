// YouTube Data API (Jarvis's one Google key): what's getting views right now, for Growth Lab trend research.
// Free quota: 10,000 units a day; one search is 100 units, so ~90 searches a day.
import { googleApiKey } from "./gemini";

export const youtubeConfigured = () => !!process.env.GOOGLE_API_KEY;

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3${path}?${new URLSearchParams({ ...params, key: googleApiKey() })}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`YouTube: ${d.error?.message ?? res.status}`);
  return d;
}

// "PT1M30S" → 90
function seconds(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : Infinity;
}

// Most-viewed recent videos for a topic, including Shorts, with views per day so fast risers stand out.
export async function trendingVideos(query: string, days = 14, max = 10) {
  const after = new Date(Date.now() - days * 86_400_000).toISOString();
  const search = await yt<{ items: { id: { videoId: string } }[] }>("/search", {
    part: "id",
    q: query,
    type: "video",
    order: "viewCount",
    publishedAfter: after,
    maxResults: String(Math.min(max, 25)),
    regionCode: "US",
    relevanceLanguage: "en",
  });
  const ids = search.items.map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const v = await yt<{
    items: { id: string; snippet: { title: string; channelTitle: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string; commentCount?: string }; contentDetails: { duration: string } }[];
  }>("/videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
  return v.items.map((x) => {
    const views = Number(x.statistics.viewCount ?? 0);
    const ageDays = Math.max(1, (Date.now() - new Date(x.snippet.publishedAt).getTime()) / 86_400_000);
    return {
      title: x.snippet.title,
      channel: x.snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${x.id}`,
      views,
      viewsPerDay: Math.round(views / ageDays),
      likes: Number(x.statistics.likeCount ?? 0),
      comments: Number(x.statistics.commentCount ?? 0),
      short: seconds(x.contentDetails.duration) <= 180, // YouTube Shorts are up to 3 minutes
      published: x.snippet.publishedAt.slice(0, 10),
    };
  });
}
