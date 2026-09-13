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
  /** Total sellable units across SKUs (Pop Mart's tmpStock). */
  stock: number;
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

async function searchAllPages(keyword: string): Promise<SearchItem[]> {
  const pageSize = 50;
  let page = 1;
  const all: SearchItem[] = [];
  // Bounded loop; Hirono is ~40 items but paginate defensively.
  for (; page <= 10; page++) {
    const res = await rpc<SearchResponse>("search/public_search", {
      q: keyword,
      page,
      pageSize,
      isIncludePopNow: true,
    });
    const items = res?.items ?? [];
    all.push(...items);
    if (items.length < pageSize || all.length >= (res?.total ?? all.length)) break;
  }
  return all;
}

function deriveSeries(name: string): string {
  // "Hirono After Dark Series Fridge Magnet Blind Box" -> "After Dark"
  const m = name.match(/hirono\s+(.*?series)/i);
  if (m) return m[1].replace(/\s+series$/i, "").trim();
  return "Other";
}

function classify(detail: SpuDetail): { availability: Availability; stock: number } {
  const stock = (detail.skus ?? []).reduce(
    (sum, s) => sum + (Number(s.tmpStock) || 0),
    0,
  );
  const now = detail.currentTimestamp ?? Date.now();
  const start = detail.saleStartAt ? Date.parse(detail.saleStartAt) : 0;
  if (!detail.publish || !detail.show) return { availability: "unknown", stock };
  if (start && start > now) return { availability: "upcoming", stock };
  return { availability: stock > 0 ? "in_stock" : "sold_out", stock };
}

/** Full scan: list every Hirono product and resolve live stock for each. */
export async function scanHirono(keyword = "hirono"): Promise<ScanResult> {
  const items = (await searchAllPages(keyword)).filter(
    (it) => it.channel === "shop" && (it.areaCodes?.includes(AREA) ?? true),
  );

  // Resolve stock detail for each product with limited concurrency.
  const products: Product[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (it): Promise<Product> => {
        const name = it.name;
        const series = deriveSeries(name);
        const isAfterDark = /after\s*dark/i.test(name);
        const slug = it.slugTitle ?? "";
        let availability: Availability = "unknown";
        let stock = 0;
        let saleStartAt: string | null = it.saleStartAt ?? null;
        let sales: number | null = null;
        try {
          const detail = await rpc<SpuDetail>("ec/spu/public_FindOne", {
            id: it.id,
            channel: "shop",
          });
          const c = classify(detail);
          availability = c.availability;
          stock = c.stock;
          saleStartAt = detail.saleStartAt ?? saleStartAt;
          sales = typeof detail.sales === "number" ? detail.sales : null;
        } catch {
          availability = "unknown";
        }
        return {
          id: it.id,
          name,
          slug,
          url: `https://www.popmart.com/ph/products/${it.id}/${slug}`,
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
