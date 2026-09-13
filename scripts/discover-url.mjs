import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36",
  locale: "en-PH",
});
const page = await ctx.newPage();
await page.goto("https://www.popmart.com/ph/search/hirono", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(6000);

const links = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/products/"]')]
    .map((a) => a.getAttribute("href"))
    .filter(Boolean),
);
console.log("PRODUCT LINKS (unique):");
for (const l of [...new Set(links)].slice(0, 15)) console.log(" ", l);
await browser.close();
