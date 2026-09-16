// Hirono Finds — compliant seller aggregator.
//
// Discovers Hirono sellers from PUBLIC marketplace search pages and normalises them
// into data/finds-sellers.json (as status:"pending" — nothing goes live un-reviewed).
//
// Design rules (deliberate, keep them):
//   1. Only public, ToS-permitted sources. Marketplaces (Carousell/Shopee/eBay/Lazada)
//      expose public search + seller pages. We DO NOT log into or scrape Facebook,
//      Instagram or TikTok — those are added via /finds/submit + public profile links.
//   2. Be polite: real UA, low concurrency, delays, respect robots. This is discovery
//      of already-public seller storefronts, not bulk data extraction.
//   3. We collect only what a directory needs: shop name, public profile/shop URL,
//      the Hirono items they list, and PUBLIC trust signals (ratings, badges, age).
//
// Usage:
//   node scripts/finds-aggregate.mjs             # dry run: print candidates
//   node scripts/finds-aggregate.mjs --write     # merge into data/finds-sellers.json
//
// Each source below is an adapter you fill in with the site's current selectors.
// They start as documented stubs so the pipeline runs end-to-end today.

import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(process.cwd());
const SELLERS_FILE = path.join(ROOT, "data", "finds-sellers.json");
const WRITE = process.argv.includes("--write");
const KEYWORDS = ["hirono", "hirono after dark", "hirono popmart"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- trust scoring (mirror of lib/finds.ts scoreTrust) ------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function scoreTrust(s = {}) {
  let score = 0;
  if (s.marketplaceVerified) score += 25;
  if (s.ratingAvg != null && s.ratingCount) {
    const quality = clamp((s.ratingAvg - 3.5) / 1.5, 0, 1);
    const volume = clamp(Math.log10(s.ratingCount + 1) / 2.5, 0, 1);
    score += 30 * quality * (0.4 + 0.6 * volume);
  }
  if (s.completedSales != null) score += 15 * clamp(Math.log10(s.completedSales + 1) / 3, 0, 1);
  if (s.accountAgeMonths != null) score += 12 * clamp(s.accountAgeMonths / 24, 0, 1);
  if (s.responseRate != null) score += 8 * clamp(s.responseRate, 0, 1);
  if (s.hasReturnPolicy) score += 4;
  if (s.followers != null) score += 6 * clamp(Math.log10(s.followers + 1) / 4, 0, 1);
  return Math.round(clamp(score, 0, 100));
}

// --- source adapters ----------------------------------------------------------
// Each adapter: async ({ page, keyword }) => Candidate[]
// Candidate shape mirrors HironoSeller (partial); scoring/dedupe handled below.

async function carousell({ page, keyword }) {
  // Public search: https://www.carousell.ph/search/<keyword>
  // TODO: fill selectors for listing cards -> seller name, shop URL, price, image.
  // Skeleton returns [] so the pipeline runs; wire up when ready.
  await page.goto(`https://www.carousell.ph/search/${encodeURIComponent(keyword)}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  }).catch(() => {});
  return [];
}

async function ebay({ page, keyword }) {
  // Public search: https://www.ebay.com/sch/i.html?_nkw=<keyword>
  // eBay exposes seller feedback %/count on listing + seller pages — ideal trust signals.
  await page.goto(
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}`,
    { waitUntil: "domcontentloaded", timeout: 45000 },
  ).catch(() => {});
  return [];
}

async function shopee({ page, keyword }) {
  // Shopee PH is JS-heavy and rate-limits hard; prefer its public product API where
  // permitted, low frequency. TODO: implement politely or rely on submissions.
  void page;
  void keyword;
  return [];
}

const SOURCES = { carousell, ebay, shopee };

// --- dedupe + merge -----------------------------------------------------------
function keyOf(c) {
  return (c.profileUrl || c.contact?.shopUrl || `${c.platform}:${c.name}`)
    .toLowerCase()
    .replace(/\/+$/, "");
}

async function readSellers() {
  try {
    return JSON.parse(await fs.readFile(SELLERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function toSeller(c) {
  return {
    id: `agg_${keyOf(c).replace(/[^a-z0-9]+/gi, "_").slice(0, 48)}`,
    name: c.name,
    handle: c.handle,
    platform: c.platform,
    profileUrl: c.profileUrl,
    location: c.location,
    sellerType: c.sellerType ?? "reseller",
    contact: c.contact ?? {},
    avatar: c.avatar,
    listings: c.listings ?? [],
    signals: c.signals ?? {},
    trustScore: scoreTrust(c.signals),
    trustLevel: "unrated",
    source: "aggregated",
    status: "pending", // review before it goes live
    addedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    notes: c.notes,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/153.0 Safari/537.36",
    locale: "en-PH",
  });
  const page = await context.newPage();

  const found = new Map();
  for (const [name, adapter] of Object.entries(SOURCES)) {
    for (const keyword of KEYWORDS) {
      try {
        const candidates = await adapter({ page, keyword });
        for (const c of candidates) {
          if (!c?.name || !c?.platform) continue;
          found.set(keyOf(c), c); // last write wins → dedupe
        }
        console.log(`[${name}] "${keyword}" → ${candidates.length} candidates`);
      } catch (err) {
        console.warn(`[${name}] "${keyword}" failed: ${err.message}`);
      }
      await sleep(1500 + Math.floor(Math.random() * 1500)); // be polite
    }
  }

  await browser.close();

  const candidates = [...found.values()];
  console.log(`\nTotal unique candidates: ${candidates.length}`);

  if (!WRITE) {
    console.log("Dry run (pass --write to merge into data/finds-sellers.json):");
    console.log(JSON.stringify(candidates.map(toSeller), null, 2));
    return;
  }

  const existing = await readSellers();
  const byKey = new Map(existing.map((s) => [keyOf(s), s]));
  let added = 0;
  let refreshed = 0;
  for (const c of candidates) {
    const k = keyOf(c);
    if (byKey.has(k)) {
      const prev = byKey.get(k);
      byKey.set(k, { ...prev, listings: c.listings ?? prev.listings, signals: c.signals ?? prev.signals, lastSeen: new Date().toISOString() });
      refreshed++;
    } else {
      byKey.set(k, toSeller(c));
      added++;
    }
  }
  await fs.writeFile(SELLERS_FILE, JSON.stringify([...byKey.values()], null, 2) + "\n", "utf8");
  console.log(`Merged: +${added} new, ~${refreshed} refreshed → ${SELLERS_FILE}`);
  console.log("New/updated sellers land as status:\"pending\" — review before they go live.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
