import type { Metadata } from "next";
import Link from "next/link";
import ImportForm from "@/components/finds/ImportForm";

export const metadata: Metadata = {
  title: "Import a Facebook seller — Hirono Finds",
  description: "Paste a public Facebook post selling Hirono; we structure and score it.",
};

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <Link href="/finds" className="text-sm font-medium text-[var(--ink)]/60 transition hover:text-[var(--ink)]">
        ← Back to Hirono Finds
      </Link>

      <h1 className="mt-3 text-3xl font-bold text-[var(--ink)]">Import from Facebook</h1>
      <p className="mt-2 max-w-2xl text-[var(--ink)]/70">
        Facebook has no legal feed to crawl, so we bring posts in by hand (or later via a
        browser extension). Paste a public post that’s selling Hirono — the parser pulls out
        the seller, price, series, and contact, then queues it for review. Only paste public
        posts, and only contact info the seller shared for selling.
      </p>

      <div className="mt-6">
        <ImportForm />
      </div>
    </main>
  );
}
