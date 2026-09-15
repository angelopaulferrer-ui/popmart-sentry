// Thin client for Pop Mart's public APAC oRPC endpoints (region PH).
// Discovered by capturing the storefront's own network calls — see scripts/discover*.mjs.
// Two public procedures are all we need:
//   POST /rpc/search/public_search      -> list products by keyword
//   POST /rpc/ec/spu/public_FindOne     -> product detail incl. per-SKU stock (tmpStock)

const API_BASE = "https://prod-apac-api.popmart.com";
const AREA = "PH";
const CURRENCY = "PHP";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "x-area": AREA,
  "accept-language": "en",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36",
};

// oRPC wraps payloads as { json: ... } in both directions.
async function rpc<T>(procedure: string, input: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/rpc/${procedure}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ json: input }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${procedure} -> HTTP ${res.status}`);
  const body = (await res.json()) as { json?: T; code?: string; message?: string };
  if (body && (body as { code?: string }).code) {
    throw new Error(`${procedure} -> ${(body as { code?: string }).code}`);
  }
  return body.json as T;
}

export type Availability = "in_stock" | "sold_out" | "upcoming" | "unknown";

export interface SearchItem {
  id: string;
  name: string;
  type: string; // "normal" | "draw"
  channel: string; // "shop" | "popnow" ...
  price: number;
  mainImage: string;
  tags: string[];
  ipName?: string;
  slugTitle?: string;
  saleStartAt?: string | null;
  areaCodes?: string[];
}

interface SearchResponse {
  items: SearchItem[];
  total: number;
}

export interface Sku {
  id: string;
  tmpStock: number;
  price: number;
  name_trans?: Record<string, string>;
}

/** One buyable option of a product (e.g. "Patchwork - iPhone 17 Pro Max", or a draw's boxes). */
export interface Variant {
  skuId: string;
  name: string;
  stock: number;
  availability: Extract<Availability, "in_stock" | "sold_out" | "unknown">;
}

export interface SpuDetail {
  id: string;
  name_trans?: Record<string, string>;
  slugTitle?: string;
  publish: boolean;
  show: boolean;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
  currentTimestamp?: number;
  skus?: Sku[];
  sales?: number;
  // Real inventory rollup — remainStock is the true "units left" the storefront uses.
  indexData?: { remainStock?: number };
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  url: string;
  image: string;
  /** Price in PHP major units (e.g. 550.00). */
  price: number;
  currency: string;
  type: string;
  channel: string;
  tags: string[];
  series: string;
  isAfterDark: boolean;
  availability: Availability;
  /** Total live sellable units across all variants. */
  stock: number;
  /** Per-variant breakdown (always ≥1 entry). Multi-entry = size/model options. */
  variants: Variant[];
  saleStartAt: string | null;
  sales: number | null;
}

export interface ScanResult {
  scannedAt: string;
  keyword: string;
  totals: {
    products: number;
    inStock: number;
    soldOut: number;
    upcoming: number;
    afterDark: number;
    afterDarkInStock: number;
  };
  products: Product[];
}

// Pop Mart's search q="" returns the WHOLE catalog (~700 items, ~7 pages). We
// fetch it and filter by ipName — keyword search is fuzzy and leaks other IPs
// (e.g. "THE MONSTERS" would pull in CRYBABY), whereas ipName is exact.
// The catalog rarely changes, so cache it briefly (shared across IP switches)
// and fetch the pages in parallel to keep scans fast.
let _catalogCache: { at: number; items: SearchItem[] } | null = null;
const CATALOG_TTL = 120_000;

async function fetchCatalog(): Promise<SearchItem[]> {
  if (_catalogCache && Date.now() - _catalogCache.at < CATALOG_TTL) {
    return _catalogCache.items;
  }
  const pageSize = 100;
  const first = await rpc<SearchResponse>("search/public_search", {
    q: "",
    page: 1,
    pageSize,
    isIncludePopNow: true,
  });
  const items: SearchItem[] = [...(first?.items ?? [])];
  const total = first?.total ?? items.length;
  const pages = Math.min(30, Math.ceil(total / pageSize));
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        rpc<SearchResponse>("search/public_search", {
          q: "",
          page: i + 2,
          pageSize,
          isIncludePopNow: true,
        }),
      ),
    );
    for (const r of rest) items.push(...(r?.items ?? []));
  }
  _catalogCache = { at: Date.now(), items };
  return items;
}

function deriveSeries(name: string): string {
  // "Hirono After Dark Series Fridge Magnet Blind Box" -> "After Dark"
  const m = name.match(/hirono\s+(.*?series)/i);
  if (m) return m[1].replace(/\s+series$/i, "").trim();
  return "Other";
}

const skuName = (s: Sku): string =>
  s.name_trans?.["en"] || s.name_trans?.["en-us"] || "Standard";

// Live per-SKU stock — the same getStock call the storefront's buy button uses.
// Returns { skuId: units }, or null if the call failed (treat as unknown).
async function getNormalStock(
  spuId: string,
  skus: Sku[],
): Promise<Variant[] | null> {
  if (skus.length === 0) return null;
  try {
    const res = await rpc<{ stock: Record<string, number> }>("ec/spu/getStock", {
      spuId,
      skuIds: skus.map((s) => s.id),
      type: "normal",
    });
    const stock = res?.stock ?? {};
    return skus.map((s) => {
      const units = Number(stock[s.id]) || 0;
      return {
        skuId: s.id,
        name: skuName(s),
        stock: units,
        availability: units > 0 ? "in_stock" : "sold_out",
      } as Variant;
    });
  } catch {
    return null;
  }
}

// Live stock for a "draw" (Pop Now / pick-a-box) product: how many boxes in the
// assigned set are still available. Empty set => sold out. null if the call failed.
async function getDrawStock(spuId: string): Promise<Variant | null> {
  try {
    const res = await rpc<{ boxes?: { status: string }[] }>(
      "draw/set/public_assignSet",
      { spuId },
    );
    const available = (res?.boxes ?? []).filter((b) => b.status === "available")
      .length;
    return {
      skuId: spuId,
      name: "Blind box draw",
      stock: available,
      availability: available > 0 ? "in_stock" : "sold_out",
    };
  } catch {
    return null;
  }
}

/** Full scan: list every product for an IP (matched by ipName) and resolve live stock. */
export async function scanIp(ip = "Hirono"): Promise<ScanResult> {
  const keyword = ip.trim();
  const target = keyword.toLowerCase();
  const items = (await fetchCatalog()).filter(
    (it) =>
      it.channel === "shop" &&
      (it.ipName ?? "").toLowerCase() === target &&
      (it.areaCodes?.includes(AREA) ?? true),
  );

  // Resolve stock detail for each product with limited concurrency.
  const products: Product[] = [];
  const CONCURRENCY = 12;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (it): Promise<Product> => {
        const name = it.name;
        const series = deriveSeries(name);
        const isAfterDark = /after\s*dark/i.test(name);
        const slug = it.slugTitle ?? "";
        let availability: Availability = "unknown";
        let variants: Variant[] = [];
        let saleStartAt: string | null = it.saleStartAt ?? null;
        let sales: number | null = null;
        try {
          const detail = await rpc<SpuDetail>("ec/spu/public_FindOne", {
            id: it.id,
            channel: "shop",
          });
          saleStartAt = detail.saleStartAt ?? saleStartAt;
          sales = typeof detail.sales === "number" ? detail.sales : null;

          // Resolve live per-variant stock (draw items use a different endpoint).
          if (it.type === "draw") {
            const v = await getDrawStock(it.id);
            variants = v ? [v] : [];
          } else {
            const v = await getNormalStock(it.id, detail.skus ?? []);
            variants = v ?? [];
          }

          const now = detail.currentTimestamp ?? Date.now();
          const start = detail.saleStartAt ? Date.parse(detail.saleStartAt) : 0;
          if (!detail.publish || !detail.show) availability = "unknown";
          else if (start && start > now) availability = "upcoming";
          else if (variants.length === 0) availability = "unknown";
          else
            availability = variants.some((v) => v.availability === "in_stock")
              ? "in_stock"
              : "sold_out";
        } catch {
          availability = "unknown";
        }
        const stock = variants.reduce((sum, v) => sum + v.stock, 0);
        return {
          id: it.id,
          name,
          slug,
          url: `https://www.popmart.com/en-PH/products/${slug}/${it.id}`,
          image: it.mainImage,
          price: (it.price ?? 0) / 100,
          currency: CURRENCY,
          type: it.type,
          channel: it.channel,
          tags: it.tags ?? [],
          series,
          isAfterDark,
          availability,
          stock,
          variants,
          saleStartAt,
          sales,
        };
      }),
    );
    products.push(...resolved);
  }

  // Sort: After Dark first, then in-stock first, then by name.
  const availRank: Record<Availability, number> = {
    in_stock: 0,
    upcoming: 1,
    sold_out: 2,
    unknown: 3,
  };
  products.sort((a, b) => {
    if (a.isAfterDark !== b.isAfterDark) return a.isAfterDark ? -1 : 1;
    if (availRank[a.availability] !== availRank[b.availability])
      return availRank[a.availability] - availRank[b.availability];
    return a.name.localeCompare(b.name);
  });

  const totals = {
    products: products.length,
    inStock: products.filter((p) => p.availability === "in_stock").length,
    soldOut: products.filter((p) => p.availability === "sold_out").length,
    upcoming: products.filter((p) => p.availability === "upcoming").length,
    afterDark: products.filter((p) => p.isAfterDark).length,
    afterDarkInStock: products.filter(
      (p) => p.isAfterDark && p.availability === "in_stock",
    ).length,
  };

  return {
    scannedAt: new Date().toISOString(),
    keyword,
    totals,
    products,
  };
}
