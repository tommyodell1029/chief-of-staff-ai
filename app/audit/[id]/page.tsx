// The one-page walk-in audit, laid out for a letter-size printout (white paper, black ink, one page).
import { notFound } from "next/navigation";
import { getAudit, type Status } from "@/lib/audits/walkin";
import { outreachSettings } from "@/lib/outreach/outreach";
import PrintButton from "@/components/PrintButton";
import { adsTransparencyUrl } from "@/lib/adsLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Free Google Maps check · LaunchPad Local" };

const MARK: Record<Status, { sym: string; cls: string; word: string }> = {
  good: { sym: "✓", cls: "bg-emerald-600", word: "Looks good" },
  fix: { sym: "!", cls: "bg-amber-500", word: "Needs work" },
  unknown: { sym: "?", cls: "bg-slate-400", word: "Full audit" },
};

function phone(p?: string) {
  const d = (p ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "";
}

export default async function AuditPrint({ params }: { params: Promise<{ id: string }> }) {
  const a = getAudit(Number((await params).id));
  if (!a) notFound();
  const d = a.parsed;
  const s = outreachSettings();
  const contact = [s.senderName, phone(process.env.AUDIT_PHONE || process.env.TOMMY_PHONE), process.env.AUDIT_EMAIL || "you@yourbusiness.com", "yourbusiness.com"].filter(Boolean);
  const date = a.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const plan = d.plan === "mappack" ? { name: "Map Pack Pro", price: "$449/mo", why: "best for climbing the map" } : { name: "Local Visibility", price: "$249/mo", why: "keeps you visible and growing" };

  return (
    <div className="min-h-dvh bg-white text-slate-900 print:min-h-0">
      <style>{`@page { size: letter; margin: 0.45in; } @media print { html, body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[7.6in] px-6 py-6 print:max-w-none print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2 print:hidden">
          <a href={adsTransparencyUrl(d.listing.website)} target="_blank" rel="noreferrer" className="mr-auto text-sm text-sky-700 underline">
            Are they running Google ads? Check ↗
          </a>
          <PrintButton />
        </div>

        <header className="flex items-end justify-between border-b-4 border-slate-900 pb-2">
          <div>
            <div className="text-[11px] font-bold tracking-[0.25em] text-sky-700">LAUNCHPAD LOCAL</div>
            <h1 className="text-2xl font-extrabold leading-tight">Free Google Maps Check</h1>
            <div className="text-base font-semibold">{d.business}</div>
          </div>
          <div className="text-right text-xs text-slate-600">
            {d.city}
            <br />
            {date}
          </div>
        </header>

        <p className="mt-3 text-[13px] leading-snug">
          When someone nearby searches for what you do, Google shows three businesses first, and most calls go to them. Here&apos;s where you stand
          today, checked live on Google Maps.
        </p>

        <ol className="mt-3 space-y-2.5">
          {d.points.map((p, i) => (
            <li key={p.title} className="flex gap-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${MARK[p.status].cls}`}>{MARK[p.status].sym}</span>
              <div className="min-w-0">
                <div className="text-[14px] font-bold">
                  {i + 1}. {p.title} <span className="font-normal text-slate-500">· {MARK[p.status].word}</span>
                </div>
                {p.lines.map((l) => (
                  <div key={l} className="text-[12.5px] leading-snug text-slate-700">
                    {l}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {d.searches[0]?.top.length > 0 && (
          <div className="mt-3">
            <div className="text-[13px] font-bold">Who&apos;s in the top 3 for &quot;{d.searches[0].search}&quot; right now</div>
            <table className="mt-1 w-full text-[12px]">
              <tbody>
                {d.searches[0].top.map((t, i) => (
                  <tr key={t.name} className="border-b border-slate-200">
                    <td className="py-0.5 pr-2 font-semibold">#{i + 1}</td>
                    <td className="py-0.5">{t.name}</td>
                    <td className="py-0.5 text-right text-slate-600">
                      {t.rating ?? "–"}★ · {t.reviews} reviews
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 rounded-lg border-2 border-slate-900 p-3">
          <div className="text-[14px] font-bold">The fixes that matter most</div>
          <ol className="mt-1 list-decimal pl-5 text-[13px] leading-snug">
            {d.fixes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-[12px] leading-snug">
          <div className="rounded-lg bg-slate-100 p-3">
            <div className="font-bold">
              We do the work: {plan.name}, {plan.price}
            </div>
            <div className="text-slate-700">
              {plan.why[0].toUpperCase() + plan.why.slice(1)}. Weekly Google posts and photos, a reply to every review
              {d.plan === "mappack" ? ", a review-request system, listing cleanup across the web" : ""}, and a one-page report every month. Month to
              month, cancel anytime. No contracts, no passwords.
            </div>
          </div>
          <div className="rounded-lg bg-sky-50 p-3">
            <div className="font-bold">Founding client offer</div>
            <div className="text-slate-700">
              Our first five clients lock in their price for six months in exchange for an honest testimonial. We never guarantee a ranking (Google
              decides), but we guarantee the work.
            </div>
          </div>
        </div>

        <footer className="mt-4 flex items-end justify-between border-t-2 border-slate-900 pt-2">
          <div className="text-[13px] font-bold">Be one of the three they call first.</div>
          <div className="text-right text-[12px] text-slate-700">{contact.join(" · ")}</div>
        </footer>
      </div>
    </div>
  );
}
