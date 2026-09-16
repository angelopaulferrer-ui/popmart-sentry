"use client";

import { useState } from "react";
import { PLATFORM_LABEL, type Platform, type SellerType } from "@/lib/finds-types";

const PLATFORMS = Object.keys(PLATFORM_LABEL) as Platform[];
const SELLER_TYPES: { value: SellerType; label: string }[] = [
  { value: "reseller", label: "Reseller" },
  { value: "supplier", label: "Supplier" },
  { value: "preorder", label: "Pre-order shop" },
  { value: "official", label: "Official store" },
  { value: "unknown", label: "Not sure" },
];

type State = "idle" | "submitting" | "done" | "error";

const field =
  "w-full rounded-xl bg-[var(--paper-card)] px-3 py-2.5 text-base text-[var(--ink)] shadow-sm ring-1 ring-black/10 outline-none placeholder:text-[var(--ink)]/40 focus:ring-[var(--ink)]/30";
const label = "block text-sm font-medium text-[var(--ink)]/80";

export default function SubmitForm() {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("submitting");
    setError(null);

    const f = new FormData(e.currentTarget);
    const payload = {
      name: f.get("name"),
      platform: f.get("platform"),
      sellerType: f.get("sellerType"),
      location: f.get("location"),
      profileUrl: f.get("profileUrl"),
      sampleListingUrl: f.get("sampleListingUrl"),
      note: f.get("note"),
      contact: {
        shopUrl: f.get("shopUrl"),
        messenger: f.get("messenger"),
        viber: f.get("viber"),
        whatsapp: f.get("whatsapp"),
        email: f.get("email"),
      },
    };

    try {
      const res = await fetch("/api/finds/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-2xl bg-[var(--paper-card)] p-6 text-center ring-1 ring-black/5">
        <p className="text-lg font-semibold text-[var(--ink)]">Thanks — submitted for review 🎉</p>
        <p className="mt-1 text-[var(--ink)]/70">
          We’ll vet the seller and add them if they check out.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <a href="/finds" className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink)]/70 ring-1 ring-black/10 hover:bg-black/5">
            Back to directory
          </a>
          <button
            onClick={() => setState("idle")}
            className="rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--paper)] hover:opacity-90"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className={label} htmlFor="name">Seller / shop name *</label>
        <input id="name" name="name" required className={`mt-1 ${field}`} placeholder="e.g. MNL Blindbox Corner" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="platform">Platform *</label>
          <select id="platform" name="platform" required defaultValue="" className={`mt-1 ${field}`}>
            <option value="" disabled>Choose…</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="sellerType">Seller type</label>
          <select id="sellerType" name="sellerType" defaultValue="reseller" className={`mt-1 ${field}`}>
            {SELLER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="location">Location</label>
        <input id="location" name="location" className={`mt-1 ${field}`} placeholder="e.g. Metro Manila, PH" />
      </div>

      <div>
        <label className={label} htmlFor="profileUrl">Profile URL</label>
        <input id="profileUrl" name="profileUrl" type="url" className={`mt-1 ${field}`} placeholder="Link to their page/profile" />
      </div>

      <fieldset className="rounded-xl ring-1 ring-black/10 p-4">
        <legend className="px-1 text-sm font-medium text-[var(--ink)]/80">Contact (add at least one)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="shopUrl" type="url" className={field} placeholder="Shop URL (Shopee/Carousell…)" />
          <input name="messenger" type="url" className={field} placeholder="Messenger link (m.me/…)" />
          <input name="viber" className={field} placeholder="Viber number" />
          <input name="whatsapp" className={field} placeholder="WhatsApp number" />
          <input name="email" type="email" className={`sm:col-span-2 ${field}`} placeholder="Email" />
        </div>
      </fieldset>

      <div>
        <label className={label} htmlFor="sampleListingUrl">Sample listing URL</label>
        <input id="sampleListingUrl" name="sampleListingUrl" type="url" className={`mt-1 ${field}`} placeholder="A Hirono item they’re selling" />
      </div>

      <div>
        <label className={label} htmlFor="note">Why are they legit? (optional)</label>
        <textarea id="note" name="note" rows={3} className={`mt-1 ${field}`} placeholder="Ratings, how long you’ve bought from them, etc." />
      </div>

      {state === "error" && error && (
        <p className="rounded-xl bg-rose-100 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={state === "submitting"}
        className="w-full rounded-xl bg-[var(--ink)] px-4 py-3 text-base font-semibold text-[var(--paper)] transition hover:opacity-90 disabled:opacity-50"
      >
        {state === "submitting" ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
