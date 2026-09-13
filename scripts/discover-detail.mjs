import { chromium } from "playwright";

const id = "a9eae840-645f-4988-a366-122cc8543a9f";
const slug = "hirono-after-dark-series-fridge-magnet-blind-box";
const url = `https://www.popmart.com/ph/products/${id}/${slug}`;

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
  const body = req.postData();
  // only product/spu/sku/stock related
  if (!/product|spu|sku|stock|detail|box/i.test(u)) return;
  let txt = "";
  try {
    txt = await res.text();
  } catch {}
  hits.push({ url: u, req: body, resp: txt });
});

console.log("navigate", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
console.log("title:", await page.title());

for (const h of hits) {
  console.log("=".repeat(70));
  console.log("URL:", h.url);
  console.log("REQ:", h.req);
  console.log("RESP:", h.resp.slice(0, 1500).replace(/\s+/g, " "));
}
await browser.close();
