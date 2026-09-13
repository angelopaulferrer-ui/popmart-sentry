import { request } from "undici";
import type { WatchProduct } from "./config.js";

export type Availability = "in_stock" | "out_of_stock" | "unknown";

export interface StockResult {
  product: WatchProduct;
  availability: Availability;
  checkedAt: string;
  note?: string;
}

// Signals that the item is NOT purchasable. Pop Mart storefronts vary by region,
// so we look for a broad set of out-of-stock phrases in the raw HTML.
const OUT_OF_STOCK_SIGNALS = [
  "sold out",
  "out of stock",
  "notify me when available",
  "coming soon",
  "\"availability\":\"outofstock\"",
  "\"availability\": \"http://schema.org/outofstock\"",
];

// Signals that the item CAN be bought right now.
const IN_STOCK_SIGNALS = [
  "add to cart",
  "add to bag",
  "buy now",
  "\"availability\":\"instock\"",
  "\"availability\": \"http://schema.org/instock\"",
];

export async function checkStock(
  product: WatchProduct,
  userAgent: string,
): Promise<StockResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await request(product.url, {
      method: "GET",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      maxRedirections: 5,
    });

    if (res.statusCode < 200 || res.statusCode >= 400) {
      return {
        product,
        availability: "unknown",
        checkedAt,
        note: `HTTP ${res.statusCode}`,
      };
    }

    const html = (await res.body.text()).toLowerCase();
    const outOfStock = OUT_OF_STOCK_SIGNALS.some((s) => html.includes(s));
    const inStock = IN_STOCK_SIGNALS.some((s) => html.includes(s));

    let availability: Availability = "unknown";
    if (inStock && !outOfStock) availability = "in_stock";
    else if (outOfStock && !inStock) availability = "out_of_stock";
    else if (inStock && outOfStock) availability = "out_of_stock"; // prefer the cautious read
    return { product, availability, checkedAt };
  } catch (err) {
    return {
      product,
      availability: "unknown",
      checkedAt,
      note: (err as Error).message,
    };
  }
}
