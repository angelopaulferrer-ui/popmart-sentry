import type { Metadata } from "next";
import Link from "next/link";
import SubmitForm from "@/components/finds/SubmitForm";

export const metadata: Metadata = {
  title: "Submit a Hirono seller — Hirono Finds",
  description: "Know a legit Hirono seller or supplier? Add them to the directory.",
};

export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Link
        href="/finds"
        className="text-sm font-medium text-[var(--ink)]/60 transition hover:text-[var(--ink)]"
      >
        ← Back to Hirono Finds
      </Link>

      <h1 className="mt-3 text-3xl font-bold text-[var(--ink)]">Submit a seller</h1>
      <p className="mt-2 text-[var(--ink)]/70">
        Add a Hirono seller, supplier, or pre-order shop. Submissions go to a review
        queue and are scored for legitimacy before appearing in the directory. Only
        submit sellers you believe are genuine — and only public contact info they’ve
        already shared for selling.
      </p>

      <div className="mt-6">
        <SubmitForm />
      </div>
    </main>
  );
}
