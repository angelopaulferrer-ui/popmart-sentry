"use client";

import { useEffect, useState } from "react";

// Floating "back to top" button — appears after scrolling down. Handy on mobile
// where the product grid gets long.
export default function ScrollToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-stone-900 text-lg text-white shadow-lg ring-1 ring-white/10 transition hover:bg-stone-700 active:scale-95"
    >
      ↑
    </button>
  );
}
