"use client";

export default function PrintButton() {
  return (
    <>
      <button onClick={() => history.back()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
        ← Back
      </button>
      <button onClick={() => window.print()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
        Print / Save as PDF
      </button>
    </>
  );
}
