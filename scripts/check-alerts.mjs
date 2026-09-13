// Standalone restock checker for GitHub Actions (no build step, uses Node's global fetch).
// Mirrors lib/popmart.ts, then diffs against data/hirono-state.json and sends a
// WhatsApp message (via the free CallMeBot relay) for any Hirono product that
// transitions into stock.
//
// Env:
//   CALLMEBOT_PHONE   (required)  your WhatsApp number incl. country code, digits only (e.g. 639171234567)
//   CALLMEBOT_APIKEY  (required)  the API key CallMeBot DMs you during setup
//   ALERT_KEYWORD     (optional)  default "hirono"
//   STATE_FILE        (optional)  default data/hirono-state.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const API_BASE = "https://prod-apac-api.popmart.com";
const AREA = "PH";
const KEYWORD = process.env.ALERT_KEYWORD || "hirono";
const STATE_FILE = process.env.STATE_FILE || "data/hirono-state.json";
const PHONE = process.env.CALLMEBOT_PHONE;
const APIKEY = process.env.CALLMEBOT_APIKEY;

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

async function scan() {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const res = await rpc("search/public_search", {
      q: KEYWORD,
      page,
      pageSize: 50,
      isIncludePopNow: true,
    });
    const batch = (res?.items ?? []).filter((it) => it.channel === "shop");
    items.push(...batch);
    if ((res?.items?.length ?? 0) < 50) break;
  }

  const products = [];
  for (const it of items) {
    let availability = "unknown";
    let stock = 0;
    try {
      const d = await rpc("ec/spu/public_FindOne", { id: it.id, channel: "shop" });
      const remain = d?.indexData?.remainStock;
      stock =
        typeof remain === "number"
          ? remain
          : (d?.skus ?? []).reduce((s, k) => s + (Number(k.tmpStock) || 0), 0);
      const now = d?.currentTimestamp ?? Date.now();
      const start = d?.saleStartAt ? Date.parse(d.saleStartAt) : 0;
      if (!d?.publish || !d?.show) availability = "unknown";
      else if (start && start > now) availability = "upcoming";
      else availability = stock > 0 ? "in_stock" : "sold_out";
    } catch {
      availability = "unknown";
    }
    products.push({
      id: it.id,
      name: it.name,
      price: it.price,
      stock,
      availability,
      isAfterDark: /after\s*dark/i.test(it.name),
      url: `https://www.popmart.com/en-PH/products/${it.slugTitle ?? ""}/${it.id}`,
    });
  }
  return products;
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

// Send a WhatsApp message via the free CallMeBot relay.
async function sendWhatsApp(text) {
  if (!PHONE || !APIKEY) {
    console.log("[dry-run] no CallMeBot creds; would send:\n" + text);
    return;
  }
  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(PHONE)}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(APIKEY)}`;
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok || /error|invalid|wrong/i.test(body)) {
    console.error("CallMeBot send issue:", res.status, body.slice(0, 200));
  }
}

async function main() {
  const products = await scan();
  const prev = await loadState();
  const nextState = Object.fromEntries(products.map((p) => [p.id, p.availability]));

  // First ever run: establish baseline, no per-item spam.
  if (!prev) {
    await saveState(nextState);
    const afterDark = products.filter((p) => p.isAfterDark);
    const adIn = afterDark.filter((p) => p.availability === "in_stock").length;
    await sendWhatsApp(
      `🤖 Popmart Sentry is now watching ${products.length} Hirono products on Pop Mart PH.\n` +
        `⭐ After Dark: ${adIn}/${afterDark.length} in stock right now.\n` +
        `You'll get a ping the moment anything restocks.`,
    );
    console.log("Baseline saved; startup message sent.");
    return;
  }

  const restocked = products.filter(
    (p) => prev[p.id] && prev[p.id] !== "in_stock" && p.availability === "in_stock",
  );

  // After Dark first so the important ones lead.
  restocked.sort((a, b) => Number(b.isAfterDark) - Number(a.isAfterDark));

  for (const p of restocked) {
    const flag = p.isAfterDark ? "⭐ AFTER DARK — " : "";
    await sendWhatsApp(
      `🟢 RESTOCK on Pop Mart PH\n` +
        `${flag}${p.name}\n` +
        `${peso(p.price)} · ${p.stock} left\n` +
        `${p.url}`,
    );
    console.log("Alerted restock:", p.name);
    await sleep(4000); // stay under CallMeBot's rate limit
  }

  const changed = JSON.stringify(prev) !== JSON.stringify(nextState);
  if (changed) await saveState(nextState);
  console.log(
    `Scan done. ${products.length} products, ${restocked.length} restock alert(s), state ${
      changed ? "updated" : "unchanged"
    }.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
