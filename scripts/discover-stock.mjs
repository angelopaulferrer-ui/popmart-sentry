import { chromium } from "playwright";

// The After Dark Fridge Magnet that the site shows as BUYABLE ("Low stock").
const slug = "hirono-after-dark-series-fridge-magnet-blind-box";
const id = "a9eae840-645f-4988-a366-122cc8543a9f";
const url = `https://www.popmart.com/en-PH/products/${slug}/${id}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36",
  locale: "en-PH",
});
const page = await ctx.newPage();

const hits = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("prod-apac-api.popmart.com/rpc")) return;
  const req = res.request();
  let body = "";
  try {
    body = (await res.text());
  } catch {}
  hits.push({ url: u.replace("https://prod-apac-api.popmart.com/rpc/", ""), req: req.postData(), body });
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(7000);
console.log("title:", await page.title());

// What the buy area actually says
const buy = await page.evaluate(() => {
  const t = document.body.innerText;
  const has = (s) => new RegExp(s, "i").test(t);
  return {
    addToCart: has("add to cart"),
    buyNow: has("buy now"),
    soldOut: has("sold out"),
    lowStock: has("low stock"),
    notify: has("notify me"),
  };
});
console.log("BUY AREA:", JSON.stringify(buy));

console.log(`\n=== ${hits.length} rpc calls ===`);
for (const h of hits) {
  // surface anything that could carry stock/availability
  const interesting = /stock|inventory|sku|spu|purchas|avail|sell|cart|qty|quantity|limit/i.test(
    h.url + " " + (h.body || ""),
  );
  if (!interesting) continue;
  console.log("—".repeat(60));
  console.log("PROC:", h.url);
  if (h.req) console.log("REQ :", h.req.slice(0, 200));
  console.log("RESP:", (h.body || "").slice(0, 900).replace(/\s+/g, " "));
}
await browser.close();
