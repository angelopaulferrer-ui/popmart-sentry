import { chromium } from "playwright";

const id = "e82ea178-2d1c-4d08-8e82-24d929eda98b";
const slug = "hirono-after-dark-series-fridge-magnet-blind-box";
const candidates = [
  `https://www.popmart.com/en-PH/pop-now/set/${id}`,
  `https://www.popmart.com/en-PH/pop-now/set/${slug}/${id}`,
  `https://www.popmart.com/en-PH/products/${slug}/${id}`,
];

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
    body = await res.text();
  } catch {}
  const proc = u.replace("https://prod-apac-api.popmart.com/rpc/", "");
  if (!/stock|box|popnow|pop_now|draw|set|inventory|sku|spu/i.test(proc + " " + (req.postData() || "")))
    return;
  hits.push({ proc, req: req.postData(), body });
});

for (const url of candidates) {
  hits.length = 0;
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);
    const status = resp?.status();
    const notFound = /product not found|page not found|404/i.test(await page.content());
    const buyText = await page.evaluate(() => {
      const t = document.body.innerText;
      return ["pick one to shake", "buy multiple", "sold out", "add to cart", "notify"]
        .filter((s) => new RegExp(s, "i").test(t));
    });
    console.log(`\n### ${url}\n   HTTP ${status} notFound=${notFound} buy=${JSON.stringify(buyText)} calls=${hits.length}`);
    for (const h of hits) {
      console.log("   —", h.proc);
      if (h.req) console.log("     REQ:", h.req.slice(0, 160));
      console.log("     RES:", (h.body || "").slice(0, 500).replace(/\s+/g, " "));
    }
    if (buyText.length && !notFound) break;
  } catch (e) {
    console.log(`\n### ${url}\n   ERR ${e.message}`);
  }
}
await browser.close();
