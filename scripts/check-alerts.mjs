// Standalone restock checker for GitHub Actions (no build step, uses Node's global fetch).
// Mirrors lib/popmart.ts, then diffs against data/hirono-state.json and sends a
// Telegram message for any Hirono product that transitions into stock.
//
// Env:
//   TELEGRAM_BOT_TOKEN (required)  BotFather token
//   TELEGRAM_CHAT_ID   (required)  your chat id
//   ALERT_KEYWORD      (optional)  default "hirono"
//   STATE_FILE         (optional)  default data/hirono-state.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const API_BASE = "https://prod-apac-api.popmart.com";
const AREA = "PH";
const KEYWORD = process.env.ALERT_KEYWORD || "hirono";
const STATE_FILE = process.env.STATE_FILE || "data/hirono-state.json";
const LOG_FILE = process.env.LOG_FILE || "data/restock-log.json";
const WATCHLIST_FILE = process.env.WATCHLIST_FILE || "data/watchlist.json";
const LOG_MAX = 300;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const HEADERS = {
  "content-type": "application/json",
  "x-area": AREA,
  "accept-language": "en",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36",
};

async function rpc(procedure, input) {
  const res = await fetch(`${API_BASE}/rpc/${procedure}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`${procedure} -> HTTP ${res.status}`);
  const body = await res.json();
  if (body?.code) throw new Error(`${procedure} -> ${body.code}`);
  return body.json;
}

const peso = (cents) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    (cents || 0) / 100,
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const phDate = (iso) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

// Whole catalog (q=""), so we can filter by ipName (exact) instead of fuzzy keyword.
async function fetchCatalog() {
  const all = [];
  let total = Infinity;
  for (let page = 1; page <= 30; page++) {
    const res = await rpc("search/public_search", {
      q: "",
      page,
      pageSize: 100,
      isIncludePopNow: true,
    });
    const items = res?.items ?? [];
    all.push(...items);
    total = res?.total ?? total;
    if (items.length < 100 || all.length >= total) break;
  }
  return all;
}

async function resolveItems(items) {
  async function resolve(it) {
    let variants = [];
    let upcoming = false;
    let saleStartAt = null;
    let gated = false; // membership / early-access qualification required
    try {
      const d = await rpc("ec/spu/public_FindOne", { id: it.id, channel: "shop" });
      saleStartAt = d?.saleStartAt ?? null;
      const now = d?.currentTimestamp ?? Date.now();
      const start = d?.saleStartAt ? Date.parse(d.saleStartAt) : 0;
      upcoming = !!(start && start > now) || !d?.publish || !d?.show;
      gated =
        (d?.qualificationType && d.qualificationType !== "none") ||
        (Array.isArray(d?.userRoles) && d.userRoles.length > 0);

      if (it.type === "draw") {
        try {
          const as = await rpc("draw/set/public_assignSet", { spuId: it.id });
          const avail = (as?.boxes ?? []).filter((b) => b.status === "available").length;
          variants = [{ skuId: it.id, name: "Blind box draw", stock: avail }];
        } catch {}
      } else {
        const skus = d?.skus ?? [];
        if (skus.length) {
          try {
            const gs = await rpc("ec/spu/getStock", {
              spuId: it.id,
              skuIds: skus.map((s) => s.id),
              type: "normal",
            });
            const stock = gs?.stock ?? {};
            variants = skus.map((s) => ({
              skuId: s.id,
              name: s.name_trans?.en || s.name_trans?.["en-us"] || "Standard",
              stock: Number(stock[s.id]) || 0,
            }));
          } catch {}
        }
      }
    } catch {}
    return {
      id: it.id,
      name: it.name,
      ip: (it.ipName || "").toLowerCase(),
      price: it.price,
      saleStartAt: saleStartAt ?? null,
      isAfterDark: /after\s*dark/i.test(it.name),
      url: `https://www.popmart.com/en-PH/products/${it.slugTitle ?? ""}/${it.id}`,
      upcoming,
      gated,
      variants, // [{skuId, name, stock}]
    };
  }

  // Resolve with limited concurrency so each pass is quick yet gentle on the API.
  const products = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    products.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(resolve))));
  }
  return products;
}

// Per-variant availability keyed by skuId: "in_stock" | "sold_out".
function variantStates(products) {
  const map = {};
  for (const p of products) {
    if (p.upcoming) continue;
    for (const v of p.variants) {
      map[v.skuId] = v.stock > 0 ? "in_stock" : "sold_out";
    }
  }
  return map;
}

// Stable identity for a product so re-listings (Pop Mart re-mints a page with
// brand-new SPU/SKU ids for the SAME item) don't read as "new". Normalises the
// name: lowercase, strip punctuation, collapse whitespace.
function productKey(p) {
  return String(p.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function saveState(map) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(map, null, 2) + "\n", "utf8");
}

async function loadLog() {
  try {
    return JSON.parse(await readFile(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function appendLog(entries) {
  if (!entries.length) return;
  const log = await loadLog();
  log.unshift(...entries); // newest first
  await mkdir(dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, JSON.stringify(log.slice(0, LOG_MAX), null, 2) + "\n", "utf8");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Send a Telegram message. Proactive sends are unrestricted once you've messaged the bot.
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.log("[dry-run] no Telegram creds; would send:\n" + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) console.error("Telegram send failed:", res.status, await res.text());
  else console.log("Telegram sent.");
}

// Watchlist supports three match modes (name-substring, case-insensitive):
//   notify: exact ipName matches (e.g. "hirono", "THE MONSTERS")
//   names:  substring matches on the product NAME (e.g. "harry potter"), so a
//           collab lands regardless of which ipName bucket Pop Mart files it under.
//   early:  like names, but ALSO pings the moment the page is LISTED (before public
//           sale) and again when it becomes buyable — for early-access pass holders.
async function loadWatchlist() {
  const clean = (a) => (a ?? []).map((s) => String(s).trim()).filter(Boolean);
  try {
    const raw = JSON.parse(await readFile(WATCHLIST_FILE, "utf8"));
    if (Array.isArray(raw)) {
      const ips = clean(raw);
      if (ips.length) return { ips, names: [], early: [] };
    } else {
      const ips = clean(raw?.notify);
      const names = clean(raw?.names);
      const early = clean(raw?.early);
      if (ips.length || names.length || early.length) return { ips, names, early };
    }
  } catch {}
  return { ips: [KEYWORD], names: [], early: [] };
}

async function main() {
  const { ips: keywords, names: nameKeywords, early: earlyKeywords } =
    await loadWatchlist();
  const targets = new Set(keywords.map((k) => k.trim().toLowerCase()));
  const nameTargets = nameKeywords.map((k) => k.trim().toLowerCase());
  const earlyTargets = earlyKeywords.map((k) => k.trim().toLowerCase());
  const matchName = (terms, name, ip) =>
    terms.some((t) => String(name ?? "").toLowerCase().includes(t) || ip === t);
  const nameMatch = (name) => matchName(nameTargets, name, null);
  // A product we want early-access coverage for (by name substring or exact ip).
  const earlyMatch = (p) => matchName(earlyTargets, p.name, p.ip);
  // Fetch the catalog once, filter to watched IPs (exact ipName) OR watched
  // product-name / early-access substrings, then resolve.
  const catalog = await fetchCatalog();
  const items = catalog.filter(
    (it) =>
      it.channel === "shop" &&
      (targets.has((it.ipName ?? "").toLowerCase()) ||
        nameMatch(it.name) ||
        matchName(earlyTargets, it.name, (it.ipName ?? "").toLowerCase())),
  );
  const products = await resolveItems(items);

  // State is { skuId: status, __watchlist: [keywords] }. We NEVER wipe it on
  // config changes — that used to swallow restocks. Instead we track which IPs
  // were watched last run and only silently seed newly-added IPs.
  const prevRaw = await loadState();
  let prev = null;
  let prevWatchlist = [];
  let prevNameWatch = [];
  let prevEarlyWatch = [];
  let prevSeenKeys = new Set();
  let prevEarlyListed = new Set();
  let prevEarlyBuyable = new Set();
  if (prevRaw) {
    const lcArr = (a) => (Array.isArray(a) ? a.map((k) => String(k).toLowerCase()) : []);
    prevWatchlist = lcArr(prevRaw.__watchlist);
    prevNameWatch = lcArr(prevRaw.__nameWatch);
    prevEarlyWatch = lcArr(prevRaw.__earlyWatch);
    prevSeenKeys = new Set(
      Array.isArray(prevRaw.__seenKeys) ? prevRaw.__seenKeys : [],
    );
    prevEarlyListed = new Set(
      Array.isArray(prevRaw.__earlyListed) ? prevRaw.__earlyListed : [],
    );
    prevEarlyBuyable = new Set(
      Array.isArray(prevRaw.__earlyBuyable) ? prevRaw.__earlyBuyable : [],
    );
    prev = { ...prevRaw };
    delete prev.__watchlist;
    delete prev.__nameWatch;
    delete prev.__earlyWatch;
    delete prev.__seenKeys;
    delete prev.__earlyListed;
    delete prev.__earlyBuyable;
  }
  // Migration: an existing state file predating __seenKeys. Seed the name set
  // this run WITHOUT firing new-listing pings (else the whole current catalog
  // reads as "new"). Restock detection still runs normally.
  const seedingSeenKeys = !!prevRaw && !Array.isArray(prevRaw.__seenKeys);
  const newlyAddedIps = new Set(
    [...targets].filter((k) => !prevWatchlist.includes(k)),
  );
  // A product was already in scope last run if its ipName was watched OR its
  // name matched a name-watch term we already had. Products only NOW entering
  // scope (a freshly-added IP or name term) get seeded silently — their whole
  // back-catalog is "new" only to us, not genuinely new listings.
  const scopedBefore = (p) =>
    prevWatchlist.includes(p.ip) ||
    prevNameWatch.some((t) => String(p.name ?? "").toLowerCase().includes(t));
  // Same idea for early-access terms: if the term is freshly added this run,
  // seed its current matches silently so the existing Harry-Potter back-catalog
  // doesn't all ping as "early-access" — only genuinely-new drops will.
  const earlyScopedBefore = (p) =>
    prevEarlyWatch.some(
      (t) => String(p.name ?? "").toLowerCase().includes(t) || p.ip === t,
    );

  const inStock = (p) => p.variants.some((v) => v.stock > 0);

  // Union of every product name we've ever seen — so a re-minted page for a
  // known item never re-triggers a "new listing". Grows monotonically.
  const seenKeys = new Set(prevSeenKeys);
  for (const p of products) seenKeys.add(productKey(p));

  // Early-access bookkeeping: products we've already announced as LISTED and as
  // BUYABLE, so each state is announced exactly once. Seed freshly-added early
  // terms silently (their current matches are "new" only to us).
  const earlyProducts = products.filter(earlyMatch);
  const earlyListed = new Set(prevEarlyListed);
  const earlyBuyable = new Set(prevEarlyBuyable);
  for (const p of earlyProducts) {
    if (!earlyScopedBefore(p)) {
      earlyListed.add(productKey(p));
      if (inStock(p)) earlyBuyable.add(productKey(p));
    }
  }

  const nextState = variantStates(products);
  nextState.__watchlist = keywords;
  nextState.__nameWatch = nameKeywords;
  nextState.__earlyWatch = earlyKeywords;
  nextState.__seenKeys = [...seenKeys];
  nextState.__earlyListed = [...earlyListed];
  nextState.__earlyBuyable = [...earlyBuyable];

  // First ever run: establish baseline, no per-item spam.
  if (!prev) {
    await saveState(nextState);
    const afterDark = products.filter((p) => p.isAfterDark);
    const adIn = afterDark.filter(inStock).length;
    await sendTelegram(
      `🤖 <b>Popmart Sentry</b> is now watching <b>${products.length}</b> products (${keywords.join(", ")}) on Pop Mart PH.\n` +
        `⭐ After Dark: ${adIn}/${afterDark.length} in stock right now.\n` +
        `You'll get a ping the moment anything restocks.`,
    );
    console.log("Baseline saved; startup message sent.");
    return;
  }

  // Early-access alerts: for flagged drops, ping the moment the page is LISTED
  // (even before public sale) and again once it becomes BUYABLE — so a pass
  // holder gets the maximum head start. Each state announced exactly once.
  // Freshly-added early terms were seeded silently above, so only genuinely-new
  // drops fire here.
  for (const p of earlyProducts) {
    if (!earlyScopedBefore(p)) continue;
    const key = productKey(p);
    const buyable = inStock(p);
    const total = p.variants.reduce((a, v) => a + (v.stock || 0), 0);
    const future = p.saleStartAt && Date.parse(p.saleStartAt) > Date.now();
    const gate = p.gated ? " · 🔑 early-access / members only" : "";
    if (buyable && !earlyBuyable.has(key)) {
      const low = total <= 3 ? "⚡ only " : "";
      await sendTelegram(
        `🟢 <b>EARLY ACCESS — BUYABLE NOW</b>\n` +
          `⭐ ${esc(p.name)}\n` +
          `${peso(p.price)} · ${low}${total} left${gate}\n` +
          `Use your pass now 👉 ${p.url}`,
      );
      earlyListed.add(key);
      earlyBuyable.add(key);
      console.log("Alerted early-access BUYABLE:", p.name);
      await sleep(1500);
    } else if (!buyable && !earlyListed.has(key)) {
      const when = future
        ? `drops ${phDate(p.saleStartAt)}`
        : "page is live — check early access";
      await sendTelegram(
        `🔔 <b>LISTED — early-access watch</b>\n` +
          `⭐ ${esc(p.name)}\n` +
          `${peso(p.price)} · ${when}${gate}\n` +
          `${p.url}`,
      );
      earlyListed.add(key);
      console.log("Alerted early-access LISTED:", p.name);
      await sleep(1500);
    }
  }
  nextState.__earlyListed = [...earlyListed];
  nextState.__earlyBuyable = [...earlyBuyable];

  // Collect per-variant transitions into stock (early-watch items handled above).
  const events = [];
  for (const p of products) {
    if (p.upcoming || earlyMatch(p)) continue;
    for (const v of p.variants) {
      const now = v.stock > 0 ? "in_stock" : "sold_out";
      const before = prev[v.skuId];
      if (before && before !== "in_stock" && now === "in_stock") events.push({ p, v });
    }
  }
  // After Dark first so the important ones lead.
  events.sort((a, b) => Number(b.p.isAfterDark) - Number(a.p.isAfterDark));

  for (const { p, v } of events) {
    const flag = p.isAfterDark ? "⭐ <b>AFTER DARK</b> " : "";
    const variantLine = p.variants.length > 1 ? `\n<b>${esc(v.name)}</b>` : "";
    const low = v.stock <= 3 ? "⚡ only " : "";
    await sendTelegram(
      `🟢 <b>RESTOCK — Pop Mart PH</b>\n` +
        `${flag}${esc(p.name)}${variantLine}\n` +
        `${peso(p.price)} · ${low}${v.stock} left\n` +
        `${p.url}`,
    );
    console.log("Alerted restock:", p.name, p.variants.length > 1 ? `(${v.name})` : "");
    await sleep(1500);
  }

  // New-listing alerts: a product whose NAME we've never seen before — a
  // genuinely new item, not Pop Mart re-minting a page (new SPU/SKU ids) for one
  // we already track. We also require real, buyable stock: a fresh page with 0
  // stock is not "on sale now", so we seed it silently and let the RESTOCK path
  // ping when it actually flips in. Suppress IPs just added to the watchlist
  // (their whole back-catalog is "new" only to us).
  const newListings = seedingSeenKeys
    ? []
    : products.filter(
        (p) =>
          p.variants.length &&
          !prevSeenKeys.has(productKey(p)) &&
          scopedBefore(p) &&
          !earlyMatch(p) &&
          !p.upcoming &&
          inStock(p),
      );
  newListings.sort((a, b) => Number(b.isAfterDark) - Number(a.isAfterDark));
  for (const p of newListings.slice(0, 8)) {
    const flag = p.isAfterDark ? "⭐ <b>AFTER DARK</b> " : "";
    const total = p.variants.reduce((a, v) => a + (v.stock || 0), 0);
    const low = total <= 3 ? "⚡ only " : "";
    await sendTelegram(
      `🆕 <b>NEW listing — Pop Mart PH</b>\n` +
        `${flag}${esc(p.name)}\n` +
        `${peso(p.price)} · on sale now · ${low}${total} left\n` +
        `${p.url}`,
    );
    console.log("Alerted new listing:", p.name);
    await sleep(1500);
  }

  // Record restock history so the dashboard can show when items came back.
  const at = new Date().toISOString();
  await appendLog(
    events.map(({ p, v }) => ({
      at,
      id: p.id,
      name: p.name,
      variant: p.variants.length > 1 ? v.name : null,
      price: (p.price ?? 0) / 100, // store major PHP units for the dashboard
      stock: v.stock,
      isAfterDark: p.isAfterDark,
      url: p.url,
    })),
  );

  // Always persist (git will no-op if the file content is identical).
  await saveState(nextState);
  console.log(
    `Scan done. ${products.length} products, ${events.length} restock alert(s), ` +
      `${newlyAddedIps.size ? `seeded new IPs: ${[...newlyAddedIps].join(", ")}` : "no new IPs"}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
