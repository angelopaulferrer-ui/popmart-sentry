"use client";

import { useState } from "react";
import { parseFacebookPost, type ParsedSeller } from "@/lib/finds-parse";

const field =
  "w-full rounded-xl bg-[var(--paper-card)] px-3 py-2.5 text-base text-[var(--ink)] shadow-sm ring-1 ring-black/10 outline-none placeholder:text-[var(--ink)]/40 focus:ring-[var(--ink)]/30";
const label = "block text-sm font-medium text-[var(--ink)]/80";

export default function ImportForm() {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<null | { trustScore: number; trustLevel: string }>(null);
  const [error, setError] = useState<string | null>(null);

  // Live client-side preview — same parser the server uses, so no round-trip needed.
  const draft: ParsedSeller | null =
    text.trim() || url.trim()
      ? parseFacebookPost({ text, url: url || undefined, name: name || undefined, location: location || undefined })
      : null;

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/finds/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, url: url || undefined, name: name || undefined, location: location || undefined }),
      });
      const data = (await res.json()) as { error?: string; trustScore?: number; trustLevel?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      setSaved({ trustScore: data.trustScore ?? 0, trustLevel: data.trustLevel ?? "unrated" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setText(""); setUrl(""); setName(""); setLocation(""); setSaved(null); setError(null);
  }

  if (saved) {
    return (
      <div className="rounded-2xl bg-[var(--paper-card)] p-6 text-center ring-1 ring-black/5">
        <p className="text-lg font-semibold text-[var(--ink)]">Imported to review queue ✅</p>
        <p className="mt-1 text-[var(--ink)]/70">
          Trust score <strong>{saved.trustScore}</strong> ({saved.trustLevel}). It’ll appear in the
          directory once approved and if it clears the trust bar.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <a href="/finds" className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink)]/70 ring-1 ring-black/10 hover:bg-black/5">
            View directory
          </a>
          <button onClick={reset} className="rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--paper)] hover:opacity-90">
            Import another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Paste side */}
      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="url">Facebook post / profile / group URL</label>
          <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} type="url"
            className={`mt-1 ${field}`} placeholder="https://facebook.com/…" />
        </div>
        <div>
          <label className={label} htmlFor="text">Paste the post text</label>
          <textarea id="text" value={text} onChange={(e) => setText(e.target.value)} rows={10}
            className={`mt-1 ${field}`}
            placeholder={"e.g.\nHirono After Dark onhand ₱650 each! Full set ₱3600.\nMessage me m.me/hironohoardph or Viber 0917 123 4567\nMetro Manila, meetup or ship nationwide"} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="name">Seller name (override)</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${field}`} placeholder="If not obvious from URL" />
          </div>
          <div>
            <label className={label} htmlFor="location">Location</label>
            <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} className={`mt-1 ${field}`} placeholder="e.g. Metro Manila, PH" />
          </div>
        </div>
      </div>

      {/* Preview side */}
      <div>
        <p className={label}>Preview</p>
        {!draft ? (
          <div className="mt-1 rounded-2xl bg-[var(--paper-card)] p-6 text-center text-[var(--ink)]/50 ring-1 ring-black/5">
            Paste a post to see what gets extracted.
          </div>
        ) : (
          <div className="mt-1 space-y-3 rounded-2xl bg-[var(--paper-card)] p-4 ring-1 ring-black/5">
            <Row k="Name" v={draft.name} />
            <Row k="Handle" v={draft.handle} />
            <Row k="Type" v={draft.sellerType} />
            <Row k="Series" v={draft.listings[0]?.series} />
            <Row
              k="Price"
              v={
                draft.listings[0]?.priceMin != null
                  ? `₱${draft.listings[0].priceMin.toLocaleString("en-PH")}` +
                    (draft.listings[0].priceMax && draft.listings[0].priceMax !== draft.listings[0].priceMin
                      ? `–₱${draft.listings[0].priceMax.toLocaleString("en-PH")}`
                      : "")
                  : undefined
              }
            />
            <Row k="In stock" v={draft.listings[0] ? (draft.listings[0].inStock ? "yes" : "no / preorder") : undefined} />
            <Row k="Contact" v={Object.values(draft.contact).filter(Boolean).join(" · ") || undefined} />

            {draft.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-300">
                {draft.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}

            {error && (
              <p className="rounded-xl bg-rose-100 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-300">{error}</p>
            )}

            <button onClick={save} disabled={saving}
              className="w-full rounded-xl bg-[var(--ink)] px-4 py-3 text-base font-semibold text-[var(--paper)] transition hover:opacity-90 disabled:opacity-50">
              {saving ? "Importing…" : "Import to review queue"}
            </button>
            <p className="text-xs text-[var(--ink)]/45">
              FB sellers start low-trust (no marketplace ratings). They surface only after approval
              and once signals lift them above the trust bar.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-black/5 pb-2 text-sm last:border-0">
      <span className="text-[var(--ink)]/50">{k}</span>
      <span className={`text-right font-medium ${v ? "text-[var(--ink)]" : "text-[var(--ink)]/30"}`}>
        {v ?? "—"}
      </span>
    </div>
  );
}
