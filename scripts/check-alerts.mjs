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
      const skuIds = (d?.skus ?? []).map((s) => s.id);
      // Live, real-time stock — same call the storefront's buy button uses.
      let live = -1;
      if (skuIds.length) {
        try {
          const gs = await rpc("ec/spu/getStock", {
            spuId: it.id,
            skuIds,
            type: it.type === "draw" ? "draw" : "normal",
          });
          live = Object.values(gs?.stock ?? {}).reduce(
            (s, n) => s + (Number(n) || 0),
            0,
          );
        } catch {
          live = -1;
        }
      }
      const fallback =
        typeof d?.indexData?.remainStock === "number"
          ? d.indexData.remainStock
          : (d?.skus ?? []).reduce((s, k) => s + (Number(k.tmpStock) || 0), 0);
      stock = live >= 0 ? live : fallback;
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

async function main() {
  const products = await scan();
  const prev = await loadState();
  const nextState = Object.fromEntries(products.map((p) => [p.id, p.availability]));

  // First ever run: establish baseline, no per-item spam.
  if (!prev) {
    await saveState(nextState);
    const afterDark = products.filter((p) => p.isAfterDark);
    const adIn = afterDark.filter((p) => p.availability === "in_stock").length;
    await sendTelegram(
      `🤖 <b>Popmart Sentry</b> is now watching <b>${products.length}</b> Hirono products on Pop Mart PH.\n` +
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
    const flag = p.isAfterDark ? "⭐ <b>AFTER DARK</b> " : "";
    await sendTelegram(
      `🟢 <b>RESTOCK — Pop Mart PH</b>\n` +
        `${flag}${esc(p.name)}\n` +
        `${peso(p.price)} · ${p.stock} left\n` +
        `${p.url}`,
    );
    console.log("Alerted restock:", p.name);
    await sleep(1500);
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
