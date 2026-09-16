import Link from "next/link";
import type { Metadata } from "next";
import { getLiveSellers } from "@/lib/finds";
import FindsBrowser from "@/components/finds/FindsBrowser";

export const metadata: Metadata = {
  title: "Hirono Finds — where to buy Hirono in PH",
  description:
    "A vetted directory of Hirono sellers, suppliers and pre-order shops across Carousell, Shopee, eBay and more — scored for legitimacy.",
};

// Re-read the seed/aggregated data on each request during MVP.
export const dynamic = "force-dynamic";

export default async function FindsPage() {
  const sellers = await getLiveSellers();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--ink)]/50">
            Popmart Sentry
          </p>
          <h1 className="mt-1 text-3xl font-bold text-[var(--ink)] sm:text-4xl">Hirono Finds</h1>
          <p className="mt-2 max-w-xl text-[var(--ink)]/70">
            A vetted directory of people and shops selling Hirono in the Philippines —
            resellers, suppliers, and pre-order sellers, each scored for legitimacy from
            public signals.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink)]/70 ring-1 ring-black/10 transition hover:bg-black/5"
          >
            ← Stock watch
          </Link>
          <Link
            href="/finds/import"
            className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink)]/70 ring-1 ring-black/10 transition hover:bg-black/5"
          >
            Import from FB
          </Link>
          <Link
            href="/finds/submit"
            className="rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--paper)] transition hover:opacity-90"
          >
            Submit a seller
          </Link>
        </div>
      </header>

      <div className="mt-8">
        <FindsBrowser sellers={sellers} />
      </div>

      <p className="mt-10 text-xs leading-relaxed text-[var(--ink)]/45">
        Listings are aggregated from public marketplace pages and community submissions.
        Trust scores are automated estimates from public signals (ratings, account age,
        verified badges) — not a guarantee. Always verify before paying, and prefer
        buyer-protected checkout over direct transfers.
      </p>
    </main>
  );
}
