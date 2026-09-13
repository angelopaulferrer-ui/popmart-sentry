"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanResult, Product, Availability } from "@/lib/popmart";

const REFRESH_MS = 60_000;

// Variants with this many units or fewer (but >0) are "running low".
const LOW_STOCK_THRESHOLD = 3;

const isLowVariant = (v: { stock: number }) =>
  v.stock > 0 && v.stock <= LOW_STOCK_THRESHOLD;

// A product is "low stock" if it's in stock and every available option is running low.
const isLowStock = (p: Product) => {
  const inStockVariants = p.variants.filter((v) => v.stock > 0);
  return (
    p.availability === "in_stock" &&
    inStockVariants.length > 0 &&
    inStockVariants.every(isLowVariant)
  );
};

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

const AVAIL_META: Record<
  Availability,
  { label: string; dot: string; text: string; ring: string }
> = {
  in_stock: {
    label: "In stock",
    dot: "bg-emerald-600",
    text: "text-emerald-800",
    ring: "ring-emerald-700/30",
  },
  sold_out: {
    label: "Sold out",
    dot: "bg-rose-600",
    text: "text-rose-800",
    ring: "ring-rose-700/25",
  },
  upcoming: {
    label: "Upcoming",
    dot: "bg-amber-500",
    text: "text-amber-800",
    ring: "ring-amber-700/25",
  },
  unknown: {
    label: "Unknown",
    dot: "bg-stone-500",
    text: "text-stone-600",
    ring: "ring-stone-500/25",
  },
};

type ScopeFilter = "all" | "afterdark";
type AvailFilter = "all" | "low" | Availability;

export default function Dashboard({
  initial,
  initialError,
}: {
  initial: ScanResult | null;
  initialError: string | null;
}) {
  const [data, setData] = useState<ScanResult | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [avail, setAvail] = useState<AvailFilter>("all");
  const [auto, setAuto] = useState(true);
  const [alertsOn, setAlertsOn] = useState(false);
  const [restocked, setRestocked] = useState<string[]>([]);
  const prevAvail = useRef<Map<string, Availability>>(new Map());

  // Seed the previous-availability map from the first server render.
  useEffect(() => {
    if (initial) {
      prevAvail.current = new Map(
        initial.products.map((p) => [p.id, p.availability]),
      );
    }
  }, [initial]);

  const notify = useCallback(
    (p: Product) => {
      if (!alertsOn || typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      new Notification("🟢 Restocked on Pop Mart PH", {
        body: `${p.name} — ${peso.format(p.price)}`,
        icon: p.image,
      });
    },
    [alertsOn],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scan?q=hirono", { cache: "no-store" });
      if (!res.ok) throw new Error(`Scan failed (HTTP ${res.status})`);
      const next = (await res.json()) as ScanResult;

      // Detect transitions into in_stock since the last scan.
      const justRestocked: string[] = [];
      for (const p of next.products) {
        const before = prevAvail.current.get(p.id);
        if (before && before !== "in_stock" && p.availability === "in_stock") {
          justRestocked.push(p.id);
          notify(p);
        }
      }
      prevAvail.current = new Map(
        next.products.map((p) => [p.id, p.availability]),
      );
      if (justRestocked.length) setRestocked(justRestocked);
      setData(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  // Auto-refresh loop.
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, refresh]);

  const enableAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setAlertsOn(perm === "granted");
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.products.filter((p) => {
      if (scope === "afterdark" && !p.isAfterDark) return false;
      if (avail === "low") return isLowStock(p);
      if (avail !== "all" && p.availability !== avail) return false;
      return true;
    });
  }, [data, scope, avail]);

  const t = data?.totals;
  const lowCount = useMemo(
    () => (data ? data.products.filter(isLowStock).length : 0),
    [data],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hirono-mark.png"
            alt="Hirono"
            width={52}
            height={52}
            className="h-13 w-13 shrink-0 rounded-xl ring-1 ring-stone-900/15"
            style={{ height: 52, width: 52 }}
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Popmart Sentry
              <span className="ml-2 rounded-full bg-stone-900/10 px-2 py-0.5 text-xs font-medium text-stone-800 ring-1 ring-stone-900/25">
                Hirono · PH
              </span>
            </h1>
            <p className="mt-1 text-sm text-stone-600">
            Live availability from popmart.com/ph ·{" "}
            {data ? (
              <>
                updated{" "}
                <time dateTime={data.scannedAt}>
                  {new Date(data.scannedAt).toLocaleTimeString()}
                </time>
              </>
            ) : (
              "—"
            )}
          </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg bg-[#e7dcc4] px-3 py-1.5 text-sm text-stone-700 ring-1 ring-stone-900/15">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="accent-stone-800"
            />
            Auto-refresh (60s)
          </label>
          <button
            onClick={enableAlerts}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
              alertsOn
                ? "bg-emerald-500/15 text-emerald-800 ring-emerald-500/30"
                : "bg-[#e7dcc4] text-stone-700 ring-stone-900/15 hover:bg-[#dccbac]"
            }`}
          >
            {alertsOn ? "🔔 Alerts on" : "Enable restock alerts"}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Refresh now"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-500/30">
          Couldn’t reach Pop Mart: {error}
        </div>
      )}

      {t && (
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Hirono products" value={t.products} />
          <Stat label="In stock" value={t.inStock} tone="emerald" />
          <Stat label="⚡ Low stock" value={lowCount} tone="amber" />
          <Stat label="Sold out" value={t.soldOut} tone="rose" />
          <Stat label="Upcoming" value={t.upcoming} tone="zinc" />
          <Stat
            label="After Dark in stock"
            value={`${t.afterDarkInStock}/${t.afterDark}`}
            tone="fuchsia"
          />
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segment
          options={[
            { k: "all", label: "All Hirono" },
            { k: "afterdark", label: "★ After Dark" },
          ]}
          value={scope}
          onChange={(v) => setScope(v as ScopeFilter)}
        />
        <span className="mx-1 h-5 w-px bg-stone-900/15" />
        <Segment
          options={[
            { k: "all", label: "Any" },
            { k: "in_stock", label: "In stock" },
            { k: "low", label: "⚡ Low" },
            { k: "sold_out", label: "Sold out" },
            { k: "upcoming", label: "Upcoming" },
          ]}
          value={avail}
          onChange={(v) => setAvail(v as AvailFilter)}
        />
        <span className="ml-auto text-sm text-stone-500">
          {filtered.length} shown
        </span>
      </div>

      {data && filtered.length === 0 && (
        <p className="rounded-lg bg-[#e7dcc4]/60 px-4 py-8 text-center text-sm text-stone-600">
          No products match this filter.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((p) => (
          <Card key={p.id} p={p} justRestocked={restocked.includes(p.id)} />
        ))}
      </div>

      <footer className="mt-10 text-center text-xs text-stone-500">
        Unofficial monitor. Stock reflects Pop Mart’s reported inventory and may
        lag the live cart.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number | string;
  tone?: "zinc" | "emerald" | "rose" | "amber" | "fuchsia";
}) {
  const tones: Record<string, string> = {
    zinc: "text-stone-900",
    emerald: "text-emerald-800",
    rose: "text-rose-800",
    amber: "text-amber-800",
    fuchsia: "text-stone-800",
  };
  return (
    <div className="rounded-xl bg-[#f6efdf] p-4 ring-1 ring-stone-900/10">
      <div className={`text-2xl font-bold ${tones[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs text-stone-600">{label}</div>
    </div>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { k: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-[#e7dcc4] p-0.5 ring-1 ring-stone-900/15">
      {options.map((o) => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            value === o.k
              ? "bg-stone-900 text-white"
              : "text-stone-700 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Card({ p, justRestocked }: { p: Product; justRestocked: boolean }) {
  const meta = AVAIL_META[p.availability];
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className={`group relative flex flex-col overflow-hidden rounded-xl bg-[#f6efdf] ring-1 transition hover:ring-stone-900/35 ${
        p.isAfterDark ? "ring-stone-900/25" : "ring-stone-900/10"
      }`}
    >
      {p.isAfterDark && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          After Dark
        </span>
      )}
      {justRestocked ? (
        <span className="absolute right-2 top-2 z-10 animate-pulse rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">
          RESTOCKED
        </span>
      ) : (
        isLowStock(p) && (
          <span className="absolute right-2 top-2 z-10 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">
            ⚡ LOW STOCK
          </span>
        )
      )}
      <div className="aspect-square w-full overflow-hidden bg-[#e2d6bd]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={p.image}
          alt={p.name}
          loading="lazy"
          className="h-full w-full object-cover transition group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${meta.text} ${meta.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          {p.availability === "in_stock" && (
            <span
              className={`text-xs ${
                p.stock <= LOW_STOCK_THRESHOLD ? "font-semibold text-amber-700" : "text-stone-500"
              }`}
            >
              {p.stock} left
            </span>
          )}
          {p.type === "draw" && (
            <span className="rounded bg-[#e2d6bd] px-1.5 py-0.5 text-[10px] text-stone-600">
              POP NOW
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-medium text-stone-900">
          {p.name}
        </h3>

        {p.variants.length > 1 && (
          <ul className="mt-2 space-y-1">
            {p.variants.map((v) => (
              <li
                key={v.skuId}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-1.5 text-stone-700">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      v.availability === "in_stock" ? "bg-emerald-600" : "bg-rose-600"
                    }`}
                  />
                  {v.name}
                </span>
                <span
                  className={
                    v.availability !== "in_stock"
                      ? "text-stone-500"
                      : isLowVariant(v)
                        ? "font-semibold text-amber-700"
                        : "text-emerald-800"
                  }
                >
                  {v.availability === "in_stock"
                    ? `${isLowVariant(v) ? "⚡ " : ""}${v.stock} left`
                    : "sold out"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-sm font-semibold text-stone-800">
            {peso.format(p.price)}
          </span>
          <span className="text-[11px] text-stone-500">{p.series}</span>
        </div>
      </div>
    </a>
  );
}
