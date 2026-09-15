"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    ring: "ring-emerald-400/40",
  },
  sold_out: {
    label: "Sold out",
    dot: "bg-rose-400",
    text: "text-rose-300",
    ring: "ring-rose-400/40",
  },
  upcoming: {
    label: "Upcoming",
    dot: "bg-amber-400",
    text: "text-amber-300",
    ring: "ring-amber-400/40",
  },
  unknown: {
    label: "Unknown",
    dot: "bg-stone-500",
    text: "text-stone-400",
    ring: "ring-stone-500/40",
  },
};

type ScopeFilter = "all" | "afterdark";
type AvailFilter = "all" | "low" | "latest" | "hot" | Availability;

const hasTag = (p: Product, tag: string) =>
  (p.tags || []).some((t) => t.toUpperCase() === tag);

type RestockEvent = {
  at: string;
  id: string;
  name: string;
  variant: string | null;
  price: number;
  stock: number;
  isAfterDark: boolean;
  url: string;
  note?: string;
};

const phTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

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
  const [showLog, setShowLog] = useState(false);
  const [logEvents, setLogEvents] = useState<RestockEvent[] | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [showHelper, setShowHelper] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const [activeIp, setActiveIp] = useState(initial?.keyword || "Hirono");
  const [watched, setWatched] = useState<string[]>([initial?.keyword || "Hirono"]);
  const [allIps, setAllIps] = useState<string[]>([]);
  const [showManage, setShowManage] = useState(false);
  const prevAvail = useRef<Map<string, Availability>>(new Map());
  const baselineKw = useRef<string>(initial?.keyword || "Hirono");

  // Seed the previous-availability map from the first server render.
  useEffect(() => {
    if (initial) {
      prevAvail.current = new Map(
        initial.products.map((p) => [p.id, p.availability]),
      );
    }
  }, [initial]);

  // Load the saved IP watchlist (per-device) + the full IP roster for the picker.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("watchedIps") || "[]");
      if (Array.isArray(saved) && saved.length) {
        setWatched(saved);
        if (!saved.includes(activeIp)) setActiveIp(saved[0]);
      }
    } catch {}
    fetch("/api/ips")
      .then((r) => r.json())
      .then((j) => Array.isArray(j.ips) && setAllIps(j.ips))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveWatched = useCallback((list: string[]) => {
    setWatched(list);
    try {
      localStorage.setItem("watchedIps", JSON.stringify(list));
    } catch {}
  }, []);

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

  const refresh = useCallback(
    async (kw?: string) => {
      const keyword = kw || activeIp;
      setLoading(true);
      try {
        const res = await fetch(`/api/scan?q=${encodeURIComponent(keyword)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Scan failed (HTTP ${res.status})`);
        const next = (await res.json()) as ScanResult;

        // Only diff for restocks when staying on the same IP (avoid cross-IP false flags).
        const sameIp = baselineKw.current === keyword;
        const justRestocked: string[] = [];
        if (sameIp) {
          for (const p of next.products) {
            const before = prevAvail.current.get(p.id);
            if (before && before !== "in_stock" && p.availability === "in_stock") {
              justRestocked.push(p.id);
              notify(p);
            }
          }
        }
        prevAvail.current = new Map(
          next.products.map((p) => [p.id, p.availability]),
        );
        baselineKw.current = keyword;
        setRestocked(sameIp && justRestocked.length ? justRestocked : []);
        setData(next);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [notify, activeIp],
  );

  // Auto-refresh loop.
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, refresh]);

  // Refetch when switching the active IP (skip the initial Hirono SSR render).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (activeIp === (initial?.keyword || "Hirono")) return;
    }
    refresh(activeIp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIp]);

  const enableAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setAlertsOn(perm === "granted");
  }, []);

  const openLog = useCallback(async () => {
    setShowLog(true);
    setLogLoading(true);
    try {
      const r = await fetch("/api/restock-log", { cache: "no-store" });
      const j = await r.json();
      setLogEvents(Array.isArray(j.events) ? j.events : []);
    } catch {
      setLogEvents([]);
    } finally {
      setLogLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const hironoView = /hirono/i.test(activeIp);
    let list = data.products.filter((p) => {
      if (hironoView && scope === "afterdark" && !p.isAfterDark) return false;
      if (avail === "low") return isLowStock(p);
      if (avail === "latest") return hasTag(p, "NEW");
      if (avail === "hot") return hasTag(p, "HOT");
      if (avail !== "all" && p.availability !== avail) return false;
      return true;
    });
    // Latest = newest releases first.
    if (avail === "latest") {
      list = [...list].sort(
        (a, b) =>
          (Date.parse(b.saleStartAt || "") || 0) -
          (Date.parse(a.saleStartAt || "") || 0),
      );
    }
    return list;
  }, [data, scope, avail, activeIp]);

  const t = data?.totals;
  const lowCount = useMemo(
    () => (data ? data.products.filter(isLowStock).length : 0),
    [data],
  );
  const isHirono = /hirono/i.test(activeIp);
  const effScope: ScopeFilter = isHirono ? scope : "all";

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
                {activeIp} · PH
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
            onClick={() => setShowNews(true)}
            className="rounded-lg bg-[#e7dcc4] px-3 py-1.5 text-sm font-medium text-stone-700 ring-1 ring-stone-900/15 transition hover:bg-[#dccbac]"
          >
            📰 News &amp; updates
          </button>
          <button
            onClick={() => setShowHelper(true)}
            className="rounded-lg bg-[#e7dcc4] px-3 py-1.5 text-sm font-medium text-stone-700 ring-1 ring-stone-900/15 transition hover:bg-[#dccbac]"
          >
            🎲 Pop Now helper
          </button>
          <button
            onClick={openLog}
            className="rounded-lg bg-[#e7dcc4] px-3 py-1.5 text-sm font-medium text-stone-700 ring-1 ring-stone-900/15 transition hover:bg-[#dccbac]"
          >
            🕒 Restock log
          </button>
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Refresh now"}
          </button>
        </div>
      </header>

      {/* IP switcher */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-stone-500">Watching:</span>
        {watched.map((ip) => (
          <button
            key={ip}
            onClick={() => setActiveIp(ip)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              ip === activeIp
                ? "bg-stone-900 text-white"
                : "bg-[#e7dcc4] text-stone-700 ring-1 ring-stone-900/15 hover:bg-[#dccbac]"
            }`}
          >
            {ip}
          </button>
        ))}
        <button
          onClick={() => setShowManage(true)}
          className="rounded-full border border-dashed border-stone-900/30 px-3 py-1 text-sm font-medium text-stone-600 hover:bg-[#e7dcc4]"
        >
          ＋ Add / manage IPs
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-500/30">
          Couldn’t reach Pop Mart: {error}
        </div>
      )}

      {t && (
        <section
          className={`mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 ${
            isHirono ? "lg:grid-cols-6" : "lg:grid-cols-5"
          }`}
        >
          <Stat label={`${activeIp} products`} value={t.products} />
          <Stat label="In stock" value={t.inStock} tone="emerald" />
          <Stat label="⚡ Low stock" value={lowCount} tone="amber" />
          <Stat label="Sold out" value={t.soldOut} tone="rose" />
          <Stat label="Upcoming" value={t.upcoming} tone="zinc" />
          {isHirono && (
            <Stat
              label="After Dark in stock"
              value={`${t.afterDarkInStock}/${t.afterDark}`}
              tone="fuchsia"
            />
          )}
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isHirono && (
          <>
            <Segment
              options={[
                { k: "all", label: "All Hirono" },
                { k: "afterdark", label: "★ After Dark" },
              ]}
              value={scope}
              onChange={(v) => setScope(v as ScopeFilter)}
            />
            <span className="mx-1 h-5 w-px bg-stone-900/15" />
          </>
        )}
        <Segment
          options={[
            { k: "all", label: "Any" },
            { k: "latest", label: "Latest" },
            { k: "hot", label: "Hot" },
            { k: "in_stock", label: "In stock" },
            { k: "low", label: "Low" },
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

      {/* Responsive: horizontal rows on phones, grid cards on sm+ screens. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((p) => (
          <Card key={p.id} p={p} justRestocked={restocked.includes(p.id)} />
        ))}
      </div>

      <footer className="mt-10 text-center text-xs text-stone-500">
        Unofficial monitor. Stock reflects Pop Mart’s reported inventory and may
        lag the live cart.
      </footer>

      {showLog && (
        <RestockLogModal
          events={logEvents}
          loading={logLoading}
          onClose={() => setShowLog(false)}
        />
      )}

      {showHelper && <PopNowHelper onClose={() => setShowHelper(false)} />}

      {showNews && (
        <NewsModal
          products={data?.products ?? []}
          onClose={() => setShowNews(false)}
        />
      )}

      {showManage && (
        <ManageIpsModal
          watched={watched}
          allIps={allIps}
          active={activeIp}
          onSelect={(ip) => setActiveIp(ip)}
          onSave={saveWatched}
          onClose={() => setShowManage(false)}
        />
      )}
    </main>
  );
}

// ---- Manage watched IPs ---------------------------------------------------

function ManageIpsModal({
  watched,
  allIps,
  active,
  onSelect,
  onSave,
  onClose,
}: {
  watched: string[];
  allIps: string[];
  active: string;
  onSelect: (ip: string) => void;
  onSave: (list: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const add = (ip: string) => {
    const name = ip.trim();
    if (!name) return;
    if (!watched.some((w) => w.toLowerCase() === name.toLowerCase()))
      onSave([...watched, name]);
    setQuery("");
    onSelect(name);
  };
  const remove = (ip: string) => {
    const list = watched.filter((w) => w !== ip);
    onSave(list.length ? list : ["Hirono"]);
    if (active === ip) onSelect((list[0] as string) || "Hirono");
  };
  const suggestions = allIps
    .filter(
      (ip) =>
        ip.toLowerCase().includes(query.toLowerCase()) &&
        !watched.some((w) => w.toLowerCase() === ip.toLowerCase()),
    )
    .slice(0, 8);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-[#f6efdf] shadow-xl ring-1 ring-stone-900/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-900/10 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-stone-900">Watched IPs</h2>
            <p className="text-xs text-stone-500">
              Monitor any Pop Mart IP on this device.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-stone-900 px-3 py-1 text-sm font-medium text-white hover:bg-stone-700"
          >
            Done
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {watched.map((ip) => (
              <span
                key={ip}
                className="inline-flex items-center gap-1 rounded-full bg-[#e7dcc4] px-2.5 py-1 text-sm text-stone-800 ring-1 ring-stone-900/15"
              >
                {ip}
                <button
                  onClick={() => remove(ip)}
                  className="text-stone-500 hover:text-rose-700"
                  aria-label={`Remove ${ip}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          <div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add(query)}
              placeholder="Search an IP (e.g. SKULLPANDA) or type any name…"
              className="w-full rounded-md bg-white p-2 text-sm text-stone-900 ring-1 ring-stone-900/15"
            />
            {query && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions.map((ip) => (
                  <button
                    key={ip}
                    onClick={() => add(ip)}
                    className="rounded-full bg-white px-2.5 py-1 text-xs text-stone-800 ring-1 ring-stone-900/15 hover:bg-stone-100"
                  >
                    ＋ {ip}
                  </button>
                ))}
                <button
                  onClick={() => add(query)}
                  className="rounded-full bg-stone-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-stone-700"
                >
                  ＋ Add “{query.trim()}”
                </button>
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-stone-500">
            This controls what you <b>monitor on the dashboard</b> (saved to this
            device). Telegram alerts follow a separate server list — tell me which IPs
            to add there, or ask to enable self-service alert management.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- News & updates -------------------------------------------------------

function relTime(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  const past = ms < 0;
  const a = Math.abs(ms);
  const d = Math.floor(a / 86_400_000);
  const h = Math.floor((a % 86_400_000) / 3_600_000);
  const m = Math.floor((a % 3_600_000) / 60_000);
  const s = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return past ? `${s} ago` : `in ${s}`;
}

function nextFriday(): Date {
  const now = new Date();
  const add = (5 - now.getDay() + 7) % 7; // Fri = 5; 0 means today is Friday
  const d = new Date(now);
  d.setDate(now.getDate() + add);
  d.setHours(0, 0, 0, 0);
  return d;
}

function NewsModal({
  products,
  onClose,
}: {
  products: Product[];
  onClose: () => void;
}) {
  const now = Date.now();
  const withDate = products.filter((p) => p.saleStartAt);

  const upcoming = withDate
    .filter((p) => Date.parse(p.saleStartAt as string) > now)
    .sort((a, b) => Date.parse(a.saleStartAt!) - Date.parse(b.saleStartAt!));

  const recent = withDate
    .filter((p) => {
      const t = Date.parse(p.saleStartAt as string);
      return t <= now && now - t <= 14 * 86_400_000;
    })
    .sort((a, b) => Date.parse(b.saleStartAt!) - Date.parse(a.saleStartAt!));

  const fri = nextFriday();
  const friLabel = fri.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const isToday = fri.toDateString() === new Date().toDateString();

  const row = (p: Product, kind: "up" | "recent") => (
    <a
      key={p.id + kind}
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg bg-stone-950 p-2.5 text-stone-100 hover:bg-stone-900"
    >
      <Image
        src={p.image}
        alt=""
        width={48}
        height={48}
        className="h-12 w-12 shrink-0 rounded object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {p.isAfterDark && (
            <span className="mr-1 rounded bg-stone-800 px-1 py-0.5 text-[10px] font-bold uppercase text-amber-300">
              After Dark
            </span>
          )}
          {p.name}
        </p>
        <p className="text-xs text-stone-400">
          {new Date(p.saleStartAt!).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}{" "}
          ·{" "}
          <span className={kind === "up" ? "text-amber-300" : "text-emerald-400"}>
            {relTime(p.saleStartAt!)}
          </span>
        </p>
      </div>
    </a>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-[#f6efdf] shadow-xl ring-1 ring-stone-900/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-900/10 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-stone-900">📰 News &amp; updates</h2>
            <p className="text-xs text-stone-500">
              Hirono drop timing — live from Pop Mart PH’s schedule
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-stone-900 px-3 py-1 text-sm font-medium text-white hover:bg-stone-700"
          >
            Close
          </button>
        </div>

        <div className="max-h-[68vh] space-y-5 overflow-y-auto p-4">
          {/* Weekly cadence */}
          <div className="rounded-xl bg-stone-900 p-3 text-stone-100">
            <p className="text-sm font-semibold text-white">🗓️ Weekly drop</p>
            <p className="mt-0.5 text-xs text-stone-300">
              Pop Mart PH releases new items every <b>Friday</b>.{" "}
              {isToday ? (
                <span className="text-amber-300">Today is drop day! 🎉</span>
              ) : (
                <>
                  Next Friday: <b className="text-white">{friLabel}</b>.
                </>
              )}
            </p>
          </div>

          {/* Upcoming */}
          <div>
            <h3 className="mb-2 text-sm font-bold text-stone-900">
              ⏳ Upcoming Hirono drops
            </h3>
            {upcoming.length ? (
              <div className="space-y-2">{upcoming.map((p) => row(p, "up"))}</div>
            ) : (
              <p className="rounded-lg bg-[#efe7d3] p-3 text-xs text-stone-600 ring-1 ring-stone-900/10">
                No Hirono items are pre-scheduled in the PH store right now. New
                series usually appear here 1–2 weeks before launch — and you’ll get a
                Telegram ping the moment any of them go live.
              </p>
            )}
          </div>

          {/* Recently launched */}
          <div>
            <h3 className="mb-2 text-sm font-bold text-stone-900">
              🆕 Recently launched (last 14 days)
            </h3>
            {recent.length ? (
              <div className="space-y-2">{recent.map((p) => row(p, "recent"))}</div>
            ) : (
              <p className="rounded-lg bg-[#efe7d3] p-3 text-xs text-stone-600 ring-1 ring-stone-900/10">
                Nothing launched in the last two weeks.
              </p>
            )}
          </div>

          {/* Good to know */}
          <div className="rounded-lg bg-[#efe7d3] p-3 text-[11px] leading-relaxed text-stone-600 ring-1 ring-stone-900/10">
            <b>Good to know:</b> Hirono sells out fast — for hot drops, use POP NOW at
            launch or pre-order. Major collabs are usually teased ~quarterly and drop
            4–6 weeks later. For teasers before they hit the store, follow{" "}
            <a
              className="underline"
              href="https://www.instagram.com/hirono_lang/"
              target="_blank"
              rel="noreferrer"
            >
              @hirono_lang
            </a>{" "}
            and{" "}
            <a
              className="underline"
              href="https://www.popmart.com/ph/collection/21/hirono"
              target="_blank"
              rel="noreferrer"
            >
              the PH Hirono page
            </a>
            .
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Pop Now odds helper --------------------------------------------------

type PopNowPreset = { label: string; regulars: string[]; secret: string; ratio: number };

const POPNOW_PRESETS: Record<string, PopNowPreset> = {
  "mist-walker": {
    label: "Hirono · Mist-Walker",
    regulars: [
      "The Primordial Grace",
      "The Gap-Glimmer Wanderer",
      "The Unfallen Wing",
      "The Backlit Messenger",
      "The Wingless Follower",
      "The Soul Corroder",
    ],
    secret: "The Tempered Aegis",
    ratio: 72,
  },
};

type BoxCell = { soldOut: boolean; not: string[] };

// Exact per-box odds across a full set via no-duplicate constraint solving.
// Enumerates all valid figure→box assignments (n! max, tiny) honoring each box's
// NOT hints, then returns per-box figure counts + total.
function analyzeSet(regulars: string[], boxes: BoxCell[]) {
  const n = boxes.length;
  const counts: Record<string, number>[] = boxes.map(() => ({}));
  if (regulars.length !== n) {
    // Fallback: independent per-box candidates (can't solve a non-standard set).
    boxes.forEach((b, i) => {
      for (const f of regulars) if (!b.not.includes(f)) counts[i][f] = 1;
    });
    return { counts, total: 1, exact: false };
  }
  let total = 0;
  const used = new Array(regulars.length).fill(false);
  const assign: (string | null)[] = new Array(n).fill(null);
  const rec = (slot: number) => {
    if (slot === n) {
      total++;
      for (let i = 0; i < n; i++) {
        const f = assign[i] as string;
        counts[i][f] = (counts[i][f] || 0) + 1;
      }
      return;
    }
    for (let f = 0; f < regulars.length; f++) {
      if (used[f]) continue;
      const fig = regulars[f];
      if (boxes[slot].not.includes(fig)) continue;
      used[f] = true;
      assign[slot] = fig;
      rec(slot + 1);
      used[f] = false;
      assign[slot] = null;
    }
  };
  rec(0);
  return { counts, total, exact: true };
}

function PopNowHelper({ onClose }: { onClose: () => void }) {
  const [series, setSeries] = useState<"mist-walker" | "custom">("mist-walker");
  const [customText, setCustomText] = useState("");
  const [customSecret, setCustomSecret] = useState("");
  const [customRatio, setCustomRatio] = useState(72);
  const [boxes, setBoxes] = useState<BoxCell[]>(
    Array.from({ length: 6 }, () => ({ soldOut: false, not: [] })),
  );
  const [target, setTarget] = useState("");

  const preset = series !== "custom" ? POPNOW_PRESETS[series] : null;
  const regulars = preset
    ? preset.regulars
    : customText
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter((s) => s && s !== customSecret.trim());
  const secret = preset ? preset.secret : customSecret.trim() || null;
  const ratio = preset ? preset.ratio : Number(customRatio) || 0;

  const toggleNot = (bi: number, fig: string) =>
    setBoxes((prev) =>
      prev.map((b, i) =>
        i !== bi
          ? b
          : {
              ...b,
              not: b.not.includes(fig)
                ? b.not.filter((x) => x !== fig)
                : [...b.not, fig],
            },
      ),
    );
  const toggleSold = (bi: number) =>
    setBoxes((prev) =>
      prev.map((b, i) => (i === bi ? { ...b, soldOut: !b.soldOut } : b)),
    );
  const resetBoxes = () =>
    setBoxes(Array.from({ length: 6 }, () => ({ soldOut: false, not: [] })));

  const { counts, total, exact } = analyzeSet(regulars, boxes);
  const contradiction = exact && total === 0;

  const boxCandidates = (bi: number) => {
    const c = counts[bi] || {};
    const list = Object.entries(c)
      .map(([name, n]) => ({ name, pct: total ? (n / total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
    return list;
  };

  // Best available box for the chosen target figure.
  let bestForTarget: { boxes: number[]; pct: number } | null = null;
  if (target) {
    let best = -1;
    const winners: number[] = [];
    boxes.forEach((b, i) => {
      if (b.soldOut) return;
      const pct = total ? ((counts[i][target] || 0) / total) * 100 : 0;
      if (pct > best + 0.01) {
        best = pct;
        winners.length = 0;
        winners.push(i);
      } else if (Math.abs(pct - best) <= 0.01 && pct > 0) {
        winners.push(i);
      }
    });
    bestForTarget = { boxes: winners, pct: Math.max(0, best) };
  }

  const fmt = (n: number) => `${Math.round(n * 10) / 10}%`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-10"
      onClick={onClose}
    >
      <div
        className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-[#f6efdf] shadow-xl ring-1 ring-stone-900/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-900/10 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-stone-900">🎲 Pop Now helper</h2>
            <p className="text-xs text-stone-500">
              Enter each box’s hints → exact odds per box (no-duplicate solved).
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-stone-900 px-3 py-1 text-sm font-medium text-white hover:bg-stone-700"
          >
            Close
          </button>
        </div>

        <div className="max-h-[74vh] space-y-4 overflow-y-auto p-4">
          {/* Series selector */}
          <div className="flex flex-wrap items-center gap-2">
            {(["mist-walker", "custom"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setSeries(k);
                  resetBoxes();
                  setTarget("");
                }}
                className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                  series === k
                    ? "bg-stone-900 text-white"
                    : "bg-[#e7dcc4] text-stone-700 ring-1 ring-stone-900/15"
                }`}
              >
                {k === "custom" ? "Custom series" : POPNOW_PRESETS[k].label}
              </button>
            ))}
            <button
              onClick={resetBoxes}
              className="ml-auto rounded-lg bg-[#e7dcc4] px-3 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-900/15 hover:bg-[#dccbac]"
            >
              Reset boxes
            </button>
          </div>

          {series === "custom" && (
            <div className="space-y-2 rounded-lg bg-[#efe7d3] p-3 ring-1 ring-stone-900/10">
              <label className="block text-xs font-medium text-stone-600">
                Figure names — exactly 6 for a standard set (one per line)
              </label>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={4}
                placeholder={"The Foo\nThe Bar\n…"}
                className="w-full rounded-md bg-white p-2 text-sm text-stone-900 ring-1 ring-stone-900/15"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={customSecret}
                  onChange={(e) => setCustomSecret(e.target.value)}
                  placeholder="Secret name (optional)"
                  className="flex-1 rounded-md bg-white p-2 text-sm text-stone-900 ring-1 ring-stone-900/15"
                />
                <span className="text-xs text-stone-600">1 in</span>
                <input
                  type="number"
                  value={customRatio}
                  onChange={(e) => setCustomRatio(Number(e.target.value))}
                  className="w-16 rounded-md bg-white p-2 text-sm text-stone-900 ring-1 ring-stone-900/15"
                />
              </div>
            </div>
          )}

          {/* Box Status grid */}
          <div>
            <p className="mb-2 text-xs font-medium text-stone-600">
              Box Status — tap a figure to mark it “NOT” for that box; toggle Sold out.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {boxes.map((b, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-2 ring-1 ${
                    b.soldOut
                      ? "bg-stone-200/60 ring-stone-900/10"
                      : "bg-white ring-stone-900/15"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-stone-500">
                      <input
                        type="checkbox"
                        checked={b.soldOut}
                        onChange={() => toggleSold(i)}
                        className="accent-stone-800"
                      />
                      Sold out
                    </label>
                  </div>
                  {b.soldOut ? (
                    <p className="py-2 text-center text-[11px] font-medium text-stone-400">
                      SOLD OUT
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {regulars.map((f) => {
                        const off = b.not.includes(f);
                        return (
                          <button
                            key={f}
                            onClick={() => toggleNot(i, f)}
                            title={f}
                            className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                              off
                                ? "bg-rose-100 text-rose-700 line-through ring-1 ring-rose-500/30"
                                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                            }`}
                          >
                            {f.replace(/^The\s+/, "")}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Target */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-stone-600">
              Target figure:
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="rounded-md bg-white px-2 py-1 text-sm text-stone-900 ring-1 ring-stone-900/15"
            >
              <option value="">(none — show all)</option>
              {regulars.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          {/* Results */}
          <div className="space-y-2 rounded-xl bg-stone-950 p-4 text-stone-100">
            {contradiction ? (
              <p className="text-sm text-amber-300">
                ⚠️ These hints don’t fit a standard all-regular set. Double-check a
                hint — or the secret {secret ? `(⭐ ${secret})` : ""} may be in this
                set.
              </p>
            ) : (
              <>
                {bestForTarget && target && (
                  <p className="text-sm">
                    🎯{" "}
                    {bestForTarget.pct <= 0 ? (
                      <span className="text-rose-400">
                        {target} can’t be in any available box (it’s in a taken box).
                      </span>
                    ) : (
                      <span className="text-emerald-400 font-semibold">
                        Best for {target}: Box{" "}
                        {bestForTarget.boxes.map((b) => b + 1).join(" or ")} (
                        {fmt(bestForTarget.pct)})
                      </span>
                    )}
                  </p>
                )}
                {boxes.map((b, i) =>
                  b.soldOut ? null : (
                    <div key={i} className="text-xs">
                      <span className="font-semibold text-white">Box {i + 1}: </span>
                      {boxCandidates(i).length === 0 ? (
                        <span className="text-stone-400">no candidates</span>
                      ) : (
                        boxCandidates(i).map((c, j) => (
                          <span key={c.name}>
                            {j > 0 && <span className="text-stone-600"> · </span>}
                            <span
                              className={
                                target && c.name === target
                                  ? "font-semibold text-amber-300"
                                  : "text-stone-200"
                              }
                            >
                              {c.name.replace(/^The\s+/, "")} {fmt(c.pct)}
                            </span>
                          </span>
                        ))
                      )}
                    </div>
                  ),
                )}
                {secret && (
                  <p className="pt-1 text-[11px] text-stone-500">
                    ⭐ Secret ({secret}) base rate ~1/{ratio}. A set that solves
                    cleanly (above) has no secret — buying it from a reseller beats
                    chasing it.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RestockLogModal({
  events,
  loading,
  onClose,
}: {
  events: RestockEvent[] | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="max-h-[75vh] w-full max-w-lg overflow-hidden rounded-2xl bg-[#f6efdf] shadow-xl ring-1 ring-stone-900/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-900/10 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-stone-900">🕒 Restock log</h2>
            <p className="text-xs text-stone-500">
              When Hirono items came back in stock (PH time)
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-stone-900 px-3 py-1 text-sm font-medium text-white hover:bg-stone-700"
          >
            Close
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-3">
          {loading && <p className="p-6 text-center text-sm text-stone-500">Loading…</p>}
          {!loading && events && events.length === 0 && (
            <p className="p-6 text-center text-sm text-stone-500">
              No restocks logged yet. Once an item comes back in stock, it’ll appear
              here with the time — so you can spot Pop Mart’s drop patterns.
            </p>
          )}
          {!loading && events && events.length > 0 && (
            <ul className="space-y-2">
              {events.map((e, i) => (
                <li
                  key={`${e.id}-${e.at}-${i}`}
                  className="rounded-lg bg-stone-950 p-3 text-stone-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                      🟢 Restocked
                      {e.note && (
                        <span className="rounded bg-white/10 px-1 py-0.5 text-[10px] font-normal text-stone-300">
                          {e.note}
                        </span>
                      )}
                    </span>
                    <time className="text-xs text-stone-400">{phTime(e.at)}</time>
                  </div>
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-sm font-medium text-white hover:underline"
                  >
                    {e.isAfterDark && (
                      <span className="mr-1 rounded bg-stone-800 px-1 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                        After Dark
                      </span>
                    )}
                    {e.name}
                    {e.variant ? ` — ${e.variant}` : ""}
                  </a>
                  <div className="mt-0.5 text-xs text-stone-400">
                    {peso.format(e.price)} · {e.stock} left at restock
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
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
  // Layout is responsive: horizontal row on phones (<640px), vertical card on sm+.
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className={`group relative flex overflow-hidden rounded-xl bg-[#f6efdf] ring-1 transition hover:ring-stone-900/35 sm:flex-col ${
        p.isAfterDark ? "ring-stone-900/25" : "ring-stone-900/10"
      }`}
    >
      <div className="relative w-28 shrink-0 self-stretch overflow-hidden bg-[#e2d6bd] sm:aspect-square sm:w-full sm:self-auto">
        <Image
          src={p.image}
          alt={p.name}
          fill
          sizes="(max-width: 640px) 112px, (max-width: 1024px) 40vw, 25vw"
          className="object-cover transition group-hover:scale-105"
        />
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
              ⚡ LOW
            </span>
          )
        )}
      </div>
      <div className="flex flex-1 flex-col bg-stone-950 p-3 text-stone-100">
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
                p.stock <= LOW_STOCK_THRESHOLD ? "font-semibold text-amber-400" : "text-stone-400"
              }`}
            >
              {p.stock} left
            </span>
          )}
          {p.type === "draw" && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-stone-300">
              POP NOW
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-medium text-white">
          {p.name}
        </h3>

        {p.variants.length > 1 && (
          <ul className="mt-2 space-y-1">
            {p.variants.map((v) => (
              <li
                key={v.skuId}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-1.5 text-stone-200">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      v.availability === "in_stock" ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                  />
                  {v.name}
                </span>
                <span
                  className={
                    v.availability !== "in_stock"
                      ? "text-stone-400"
                      : isLowVariant(v)
                        ? "font-semibold text-amber-400"
                        : "text-emerald-400"
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
          <span className="text-sm font-semibold text-white">
            {peso.format(p.price)}
          </span>
          <span className="text-[11px] text-stone-400">{p.series}</span>
        </div>
      </div>
    </a>
  );
}
