"use client";
import { useIdentity } from "@/lib/client/identity";
// Nina Studio: set up Nina's look, have Jarvis's crew create posts, approve them (Instagram posts automatically),
// and share the rest to TikTok/Reddit/Fanvue with one tap.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { photoToDataUrl } from "@/lib/client/image";

interface Post {
  id: number;
  platforms: string;
  caption: string;
  hashtags: string | null;
  imagePrompt: string | null;
  imageFile: string | null;
  voiceoverFile: string | null;
  videoFile: string | null;
  notes: string | null;
  status: string;
  postedUrl: string | null;
  error: string | null;
  createdAt: string;
  postAt: string | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
}
interface StudioData {
  posts: Post[];
  persona: string;
  refs: string[];
  gemini: boolean;
  instagram: boolean;
  voice: boolean;
}

const PLATFORMS = ["instagram", "tiktok", "reddit", "fanvue"];
const media = (name: string) => `/api/media/${name}`;
const preview = (name: string, w = 640) => `/api/media/${name}?w=${w}`; // small JPEG for the screen

export default function NinaStudio() {
  const idn = useIdentity();
  const [data, setData] = useState<StudioData | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [quick, setQuick] = useState({ caption: "", imagePrompt: "", platforms: ["instagram"] as string[] });
  const [working, setWorking] = useState(false);

  const load = useCallback(() => {
    fetch("/api/studio")
      .then((r) => r.json())
      .then((d: StudioData) => {
        setData(d);
        setPersona((p) => p || d.persona);
      });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (url: string, body: unknown, method = "POST") => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setFlash(d.error ?? "Something went wrong.");
    return { ok: res.ok, d };
  };

  const plan = async () => {
    const { ok } = await post("/api/studio", { action: "plan", count: 3 });
    if (ok) setFlash("The Content Planner is creating 3 posts. They appear here in a few minutes (you'll get an alert).");
  };

  const planAds = async () => {
    const { ok } = await post("/api/studio", { action: "plan", kind: "ad", count: 2 });
    if (ok) setFlash("The UGC Ad Maker is creating 2 Etsy ads. They appear here in a few minutes (you'll get an alert).");
  };

  const createQuick = async () => {
    setWorking(true);
    const { ok } = await post("/api/studio", { action: "create", ...quick });
    setWorking(false);
    if (ok) {
      setQuick({ caption: "", imagePrompt: "", platforms: ["instagram"] });
      setFlash("Post created. Review it below.");
      load();
    }
  };

  const savePersona = async () => {
    const { ok } = await post("/api/studio/setup", { persona }, "PUT");
    if (ok) setFlash("Saved Nina's look.");
  };

  const addRef = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const { ok } = await post("/api/studio/setup", { photo: await photoToDataUrl(file, 1024) });
    if (ok) load();
  };

  const removeRef = async (name: string) => {
    await post("/api/studio/setup", { name }, "DELETE");
    load();
  };

  // Opened from a "time to post" reminder: /studio?post=12
  const [focusId, setFocusId] = useState<number | null>(null);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("post"));
    if (id) setFocusId(id);
  }, []);

  const drafts = data?.posts.filter((p) => p.status === "draft" || p.status === "failed") ?? [];
  const ready = data?.posts.filter((p) => p.status === "approved") ?? [];
  const done = data?.posts.filter((p) => p.status === "posted") ?? [];

  if (idn.kit) return <div className="mx-auto max-w-xl p-6 text-sm text-muted">Studio isn't part of this assistant.</div>;
  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Nina Studio</h1>
        <Link href="/connections" className="ml-auto text-sm text-accent">
          Connections →
        </Link>
      </header>

      {data && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Chip ok={data.gemini}>Images (Gemini)</Chip>
          {data.instagram && <Chip ok>Instagram auto-post</Chip>}
          <Chip ok={data.voice}>Nina&apos;s voice</Chip>
        </div>
      )}

      <p className="mb-3 text-sm text-muted">
        SFW content only. Nina posts like a real lifestyle creator; about 1 in 5 posts is an Etsy ad, labeled &quot;Ad&quot; at the start of the caption. Every image keeps Nina&apos;s look from her reference photos, and captions read as Nina, with no AI mentions.{" "}
        {data?.instagram ? (
          <>Approved Instagram posts go out automatically; other platforms get a one-tap <b>Share</b>.</>
        ) : (
          <>
            Approve a post and Jarvis picks a posting time (weekday lunch or evening, weekends late morning or early evening). At that time your phone says
            &quot;time to post&quot;: tap it, then <b>Share…</b>, and turn on the AI label in the app as you post.
          </>
        )}
      </p>

      {flash && <p className="mb-3 rounded-lg bg-accent-dim/30 px-3 py-2 text-sm text-accent">{flash}</p>}

      {/* Setup */}
      <section className="mb-4 rounded-2xl border border-line bg-panel p-4">
        <button onClick={() => setShowSetup(!showSetup)} className="flex w-full items-center justify-between text-left">
          <span className="font-semibold">Nina&apos;s look</span>
          <span className="text-xs text-muted">{data?.refs.length ?? 0}/3 reference photos · {showSetup ? "hide" : "edit"}</span>
        </button>
        {showSetup && (
          <div className="mt-3 space-y-3">
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-line bg-panel-2 p-2 text-sm"
            />
            <button onClick={savePersona} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg">
              Save description
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {data?.refs.map((r) => (
                <div key={r} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview(r, 200)} alt="Reference" loading="lazy" className="h-24 w-24 rounded-lg object-cover" />
                  <button
                    onClick={() => removeRef(r)}
                    className="absolute -right-1 -top-1 h-6 w-6 rounded-full bg-panel-2 text-xs text-muted"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(data?.refs.length ?? 0) < 3 && (
                <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
                  + Photo
                  <input type="file" accept="image/*" onChange={addRef} className="hidden" />
                </label>
              )}
            </div>
            <p className="text-xs text-muted">
              Add 1–3 clear photos of Nina&apos;s face (made in the Gemini app, for example). Never use a real person&apos;s photo.
            </p>
          </div>
        )}
      </section>

      {/* Create */}
      <section className="mb-5 rounded-2xl border border-line bg-panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button onClick={plan} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
            Plan 3 posts for me
          </button>
          <button onClick={planAds} className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent">
            Make 2 Etsy ads
          </button>
          <span className="text-xs text-muted">The Content Planner picks trending ideas (~$0.20 + ~7¢ per image)</span>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-accent">Or make one yourself</summary>
          <div className="mt-2 space-y-2 text-sm">
            <input
              value={quick.imagePrompt}
              onChange={(e) => setQuick({ ...quick, imagePrompt: e.target.value })}
              placeholder="Image idea, e.g. sunset rooftop coffee, white sweater, candid laugh"
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2"
            />
            <textarea
              value={quick.caption}
              onChange={(e) => setQuick({ ...quick, caption: e.target.value })}
              placeholder="Caption"
              rows={2}
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2"
            />
            <div className="flex flex-wrap gap-3">
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-xs capitalize">
                  <input
                    type="checkbox"
                    checked={quick.platforms.includes(p)}
                    onChange={(e) =>
                      setQuick({ ...quick, platforms: e.target.checked ? [...quick.platforms, p] : quick.platforms.filter((x) => x !== p) })
                    }
                  />
                  {p}
                </label>
              ))}
            </div>
            <button
              onClick={createQuick}
              disabled={working || !quick.caption.trim()}
              className="rounded-lg border border-accent/50 px-3 py-2 text-accent disabled:opacity-40"
            >
              {working ? "Making the image…" : "Create post"}
            </button>
          </div>
        </details>
      </section>

      <Section title={`Waiting for your OK (${drafts.length})`}>
        {drafts.length === 0 ? (
          <Empty text="No drafts. Tap “Plan 3 posts for me”." />
        ) : (
          drafts.map((p) => <PostCard key={p.id} p={p} igOn={!!data?.instagram} focus={focusId === p.id} onChanged={load} setFlash={setFlash} />)
        )}
      </Section>
      <Section title={`Ready to share (${ready.length})`}>
        {ready.length === 0 ? (
          <Empty text="Approved posts wait here until their posting time." />
        ) : (
          [...ready]
            .sort((a, b) => (a.postAt ?? "").localeCompare(b.postAt ?? ""))
            .map((p) => <PostCard key={p.id} p={p} igOn={!!data?.instagram} focus={focusId === p.id} onChanged={load} setFlash={setFlash} />)
        )}
      </Section>
      {done.length > 0 && (
        <Section title={`Posted (${done.length})`}>
          {done.slice(0, 10).map((p) => (
            <PostCard key={p.id} p={p} igOn={!!data?.instagram} focus={focusId === p.id} onChanged={load} setFlash={setFlash} />
          ))}
        </Section>
      )}
    </div>
  );
}

function PostCard({ p, igOn, focus, onChanged, setFlash }: { p: Post; igOn: boolean; focus: boolean; onChanged: () => void; setFlash: (s: string) => void }) {
  const [caption, setCaption] = useState(p.caption);
  const [hashtags, setHashtags] = useState(p.hashtags ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const platforms = JSON.parse(p.platforms) as string[];
  const fullCaption = [caption, hashtags].filter(Boolean).join("\n\n");

  // Prefetch the reel (or image) so the iPhone share sheet opens instantly on tap, but only for posts that are on
  // screen (fetching every post's full files made the page slow to load).
  const card = useRef<HTMLElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (focus) card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  const [results, setResults] = useState({ likes: p.likes?.toString() ?? "", comments: p.comments?.toString() ?? "", saves: p.saves?.toString() ?? "" });
  const saveResults = async () => {
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/[,\s]/g, "")));
    const res = await fetch(`/api/studio/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ likes: num(results.likes), comments: num(results.comments), saves: num(results.saves) }),
    });
    setFlash(res.ok ? "Results saved. They count toward Sunday's boost picks." : "Couldn't save the results.");
    onChanged();
  };
  useEffect(() => {
    const el = card.current;
    if (!el || onScreen) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setOnScreen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onScreen]);
  useEffect(() => {
    const name = p.videoFile ?? p.imageFile;
    if (p.status !== "approved" || !name || !onScreen) return;
    const video = name.endsWith(".mp4");
    fetch(media(name))
      .then((r) => r.blob())
      .then((b) => setFile(new File([b], `nina-${p.id}.${video ? "mp4" : "jpg"}`, { type: video ? "video/mp4" : "image/jpeg" })))
      .catch(() => {});
  }, [p.status, p.imageFile, p.videoFile, p.id, onScreen]);

  const act = async (action: string) => {
    setBusy(action);
    if (action === "approve" && (caption !== p.caption || hashtags !== (p.hashtags ?? ""))) {
      await fetch(`/api/studio/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, hashtags }),
      });
    }
    const res = await fetch(`/api/studio/${p.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setFlash(d.error ?? "Something went wrong.");
    else if (action === "reel") setFlash("Reel ready. Play it below, or share it once approved.");
    else if (action === "approve") {
      setFlash(
        d.post?.postedUrl
          ? "Posted to Instagram ✓"
          : d.post?.status === "failed"
            ? `Instagram said: ${d.post.error}`
            : d.post?.postAt
              ? `Approved. I'll remind you to post it ${new Date(d.post.postAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
              : "Approved. Share it from “Ready to share”.",
      );
    }
    onChanged();
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(fullCaption).catch(() => {});
      if (!p.imageFile && !p.videoFile) setFlash("This post has no image yet. Tap “New image” on it first (about 7¢), then Share.");
      else if (!file) setFlash("Still loading the file. Try Share again in a second.");
      else if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: fullCaption });
      else setFlash("Caption copied. Save the image or video (press and hold it), then post it in the app.");
    } catch {
      /* share sheet closed */
    }
  };

  return (
    <article ref={card} className={`rounded-2xl border bg-panel p-3 sm:flex sm:gap-4 ${focus ? "border-accent ring-2 ring-accent/40" : "border-line"}`}>
      {p.imageFile ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview(p.imageFile)} alt="Post" loading="lazy" decoding="async" className="mb-3 w-full rounded-xl object-cover sm:mb-0 sm:w-56" />
      ) : (
        <div className="mb-3 flex h-40 w-full items-center justify-center rounded-xl bg-panel-2 text-xs text-muted sm:mb-0 sm:w-56">No image</div>
      )}
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap gap-1">
          {platforms.map((x) => (
            <span key={x} className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] capitalize text-muted">
              {x}
            </span>
          ))}
          {p.postedUrl && (
            <a href={p.postedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-accent">
              View on Instagram ↗
            </a>
          )}
        </div>
        {p.status === "draft" || p.status === "failed" ? (
          <>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className="w-full rounded-lg border border-line bg-panel-2 p-2" />
            <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="Up to 5 hashtags" className="w-full rounded-lg border border-line bg-panel-2 p-2 text-xs" />
            {hashtags.split(/[\s,]+/).filter(Boolean).length > 5 && <p className="text-xs text-warn">Instagram and TikTok allow 5 hashtags. Only the first 5 will be kept.</p>}
          </>
        ) : (
          <p className="whitespace-pre-wrap">{fullCaption}</p>
        )}
        {p.notes && <p className="text-xs text-muted">Notes: {p.notes}</p>}
        {p.status === "posted" && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
            Results:
            {(["likes", "comments", "saves"] as const).map((k) => (
              <input
                key={k}
                value={results[k]}
                onChange={(e) => setResults({ ...results, [k]: e.target.value })}
                placeholder={k}
                inputMode="numeric"
                className="w-20 rounded-md border border-line bg-panel-2 px-2 py-1 text-ink"
              />
            ))}
            <button onClick={saveResults} className="rounded-md border border-line px-2 py-1 hover:text-ink">
              Save
            </button>
          </div>
        )}
        {p.error && <p className="text-xs text-warn">{p.error}</p>}
        {p.videoFile ? (
          <video controls playsInline preload="none" poster={p.imageFile ? preview(p.imageFile) : undefined} src={media(p.videoFile)} className="max-h-96 rounded-xl border border-line" />
        ) : (
          p.voiceoverFile && <audio controls preload="none" src={media(p.voiceoverFile)} className="w-full" />
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {(p.status === "draft" || p.status === "failed") && (
            <>
              <button onClick={() => act("approve")} disabled={!!busy} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-50">
                {busy === "approve" ? (igOn && platforms.includes("instagram") ? "Posting…" : "Approving…") : igOn && platforms.includes("instagram") ? "Approve & post" : "Approve"}
              </button>
              {p.imagePrompt && (
                <button onClick={() => act("regenerate")} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-muted disabled:opacity-50">
                  {busy === "regenerate" ? "Making…" : "New image (7¢)"}
                </button>
              )}
              {p.imageFile && (
                <button onClick={() => act("reel")} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-muted disabled:opacity-50">
                  {busy === "reel" ? "Building reel (about a minute)…" : p.videoFile ? (p.voiceoverFile ? "Rebuild reel" : "🎙 Rebuild reel with her voice") : "🎬 Make reel"}
                </button>
              )}
              <button onClick={() => act("reject")} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-muted hover:text-danger">
                Reject
              </button>
            </>
          )}
          {p.status === "approved" && p.postAt && (
            <p className="w-full text-xs text-muted">
              ⏰ Post reminder: {new Date(p.postAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}{" "}
              <button onClick={() => act("later")} disabled={!!busy} className="ml-1 text-accent hover:underline">
                Later
              </button>
            </p>
          )}
          {p.status === "approved" && (
            <>
              <button onClick={share} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg">
                Share…
              </button>
              <button onClick={() => navigator.clipboard.writeText(fullCaption).then(() => setFlash("Caption copied."))} className="rounded-lg border border-line px-3 py-1.5 text-muted">
                Copy caption
              </button>
              {!p.imageFile && p.imagePrompt && (
                <button onClick={() => act("regenerate")} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-muted disabled:opacity-50">
                  {busy === "regenerate" ? "Making…" : "New image"}
                </button>
              )}
              {p.imageFile && (!p.videoFile || !p.voiceoverFile) && (
                <button onClick={() => act("reel")} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-muted disabled:opacity-50">
                  {busy === "reel" ? "Building reel (about a minute)…" : p.videoFile ? "🎙 Rebuild reel with her voice" : "🎬 Make reel"}
                </button>
              )}
              <button onClick={() => act("shared")} className="rounded-lg px-3 py-1.5 text-muted">
                Mark posted
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2 py-0.5 ${ok ? "border-accent/50 text-accent" : "border-line text-muted"}`}>{ok ? "✓" : "○"} {children}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted">{title.toUpperCase()}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{text}</p>;
}
