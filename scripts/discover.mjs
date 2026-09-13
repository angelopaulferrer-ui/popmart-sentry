import { chromium } from "playwright";

const TARGETS = [
  "https://www.popmart.com/ph/search/hirono",
  "https://www.popmart.com/ph/search?keyword=hirono",
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36",
  locale: "en-PH",
});
const page = await ctx.newPage();

const captured = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("prod-apac-api.popmart.com")) return;
  const req = res.request();
  let body = null;
  try {
    body = req.postData();
  } catch {}
  let json = null;
  try {
    const txt = await res.text();
    json = txt.slice(0, 600);
  } catch {}
  captured.push({
    method: req.method(),
    url,
    reqBody: body ? body.slice(0, 400) : null,
    status: res.status(),
    respHead: json,
  });
});

for (const t of TARGETS) {
  console.log(`\n### NAVIGATE ${t}`);
  try {
    await page.goto(t, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);
    const title = await page.title();
    console.log("title:", title);
  } catch (e) {
    console.log("nav error:", e.message);
  }
}

console.log(`\n### CAPTURED ${captured.length} api calls`);
for (const c of captured) {
  // only show ones that look product-listy
  console.log("—".repeat(60));
  console.log(c.method, c.status, c.url);
  if (c.reqBody) console.log("  req:", c.reqBody);
  if (c.respHead) console.log("  resp:", c.respHead.replace(/\s+/g, " "));
}

await browser.close();
