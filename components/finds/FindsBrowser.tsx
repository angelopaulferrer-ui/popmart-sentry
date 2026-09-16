"use client";

import { useMemo, useState } from "react";
import type { HironoSeller, Platform, TrustLevel } from "@/lib/finds-types";
import { PLATFORM_LABEL } from "@/lib/finds-types";
import SellerCard from "./SellerCard";

type TrustFilter = "all" | "verified" | "trusted";

const TRUST_FILTERS: { key: TrustFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trusted", label: "Trusted+" },
  { key: "verified", label: "Verified only" },
];

const TRUST_RANK: Record<TrustLevel, number> = {
  caution: 0,
  unrated: 1,
  trusted: 2,
  verified: 3,
};

export default function FindsBrowser({ sellers }: { sellers: HironoSeller[] }) {
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [series, setSeries] = useState<string>("all");
  const [trust, setTrust] = useState<TrustFilter>("all");

  const platforms = useMemo(
    () => Array.from(new Set(sellers.map((s) => s.platform))),
    [sellers],
  );
  const allSeries = useMemo(
    () =>
      Array.from(
        new Set(sellers.flatMap((s) => s.listings.map((l) => l.series).filter(Boolean))),
      ).sort() as string[],
    [sellers],
  );

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sellers.filter((s) => {
      if (platform !== "all" && s.platform !== platform) return false;
      if (series !== "all" && !s.listings.some((l) => l.series === series)) return false;
      if (trust === "verified" && s.trustLevel !== "verified") return false;
      if (trust === "trusted" && TRUST_RANK[s.trustLevel] < TRUST_RANK.trusted) return false;
      if (needle) {
        const hay = [
          s.name,
          s.handle,
          s.location,
          ...s.listings.map((l) => `${l.title} ${l.series ?? ""}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [sellers, q, platform, series, trust]);

  return (
    <div>
      {/* Search */}
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sellers, series (After Dark…), locations"
          className="w-full rounded-xl bg-[var(--paper-card)] px-4 py-3 text-base text-[var(--ink)] shadow-sm ring-1 ring-black/10 outline-none placeholder:text-[var(--ink)]/40 focus:ring-[var(--ink)]/30"
        />
      </div>

      {/* Filter strips */}
      <div className="mt-3 space-y-2">
        <FilterStrip
          items={[
            { key: "all", label: "All platforms" },
            ...platforms.map((p) => ({ key: p, label: PLATFORM_LABEL[p] })),
          ]}
          active={platform}
          onPick={(k) => setPlatform(k as Platform | "all")}
        />
        {allSeries.length > 0 && (
          <FilterStrip
            items={[
              { key: "all", label: "All series" },
              ...allSeries.map((s) => ({ key: s, label: s })),
            ]}
            active={series}
            onPick={setSeries}
          />
        )}
        <FilterStrip
          items={TRUST_FILTERS}
          active={trust}
          onPick={(k) => setTrust(k as TrustFilter)}
        />
      </div>

      {/* Count */}
      <p className="mt-4 text-sm text-[var(--ink)]/60">
        {results.length} seller{results.length === 1 ? "" : "s"}
      </p>

      {/* Grid */}
      {results.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-[var(--paper-card)] p-8 text-center text-[var(--ink)]/60 ring-1 ring-black/5">
          No sellers match those filters yet.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((s) => (
            <SellerCard key={s.id} seller={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterStrip({
  items,
  active,
  onPick,
}: {
  items: { key: string; label: string }[];
  active: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            onClick={() => onPick(it.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              on
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "bg-[var(--paper-card)] text-[var(--ink)]/70 ring-1 ring-black/10 hover:bg-black/5"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
