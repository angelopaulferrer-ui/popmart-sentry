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
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

// Grab any button-like text in the buy area
const texts = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("button, [class*='btn'], [class*='Btn'], [class*='button']")) {
    const t = (el.textContent || "").trim();
    if (t && t.length < 40) out.push(t);
  }
  return [...new Set(out)];
});
console.log("BUTTONS:", JSON.stringify(texts));
await browser.close();
