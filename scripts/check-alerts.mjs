// Standalone restock checker for GitHub Actions (no build step, uses Node's global fetch).
// Mirrors lib/popmart.ts, then diffs against data/hirono-state.json and sends a
// WhatsApp message (via the official Meta WhatsApp Cloud API) for any Hirono
// product that transitions into stock.
//
// Env (all from the Meta WhatsApp > API Setup page):
//   WA_TOKEN     (required)  access token (use a permanent System User token for the cron)
//   WA_PHONE_ID  (required)  the sender "Phone number ID"
//   WA_TO        (required)  your WhatsApp number, digits only incl. country code (e.g. 639954290741)
//   WA_TEMPLATE  (optional)  approved template name for restocks; default "restock_alert"
//   WA_LANG      (optional)  template language code; default "en_US"
//   ALERT_KEYWORD(optional)  default "hirono"
//   STATE_FILE   (optional)  default data/hirono-state.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const API_BASE = "https://prod-apac-api.popmart.com";
const AREA = "PH";
const KEYWORD = process.env.ALERT_KEYWORD || "hirono";
const STATE_FILE = process.env.STATE_FILE || "data/hirono-state.json";
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_TO = process.env.WA_TO;
const WA_TEMPLATE = process.env.WA_TEMPLATE || "restock_alert";
const WA_LANG = process.env.WA_LANG || "en_US";

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

// Send a WhatsApp template message via the official Meta Cloud API.
// Template messages can be delivered proactively (no 24h-window restriction).
async function sendTemplate(name, params = [], lang = WA_LANG) {
  if (!WA_TOKEN || !WA_PHONE_ID || !WA_TO) {
    console.log(
      `[dry-run] no WhatsApp creds; would send template "${name}" with params:`,
      params,
    );
    return;
  }
  const payload = {
    messaging_product: "whatsapp",
    to: WA_TO,
    type: "template",
    template: {
      name,
      language: { code: lang },
      ...(params.length
        ? {
            components: [
              {
                type: "body",
                parameters: params.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  };
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${WA_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await res.text();
  if (!res.ok) console.error("WhatsApp send failed:", res.status, body.slice(0, 300));
  else console.log("WhatsApp sent:", name);
}

async function main() {
  const products = await scan();
  const prev = await loadState();
  const nextState = Object.fromEntries(products.map((p) => [p.id, p.availability]));

  // First ever run: establish baseline, no per-item spam. Confirm via the
  // pre-approved hello_world template (works immediately, no approval wait).
  if (!prev) {
    await saveState(nextState);
    const afterDark = products.filter((p) => p.isAfterDark);
    const adIn = afterDark.filter((p) => p.availability === "in_stock").length;
    console.log(
      `Baseline: ${products.length} Hirono products, After Dark ${adIn}/${afterDark.length} in stock.`,
    );
    await sendTemplate("hello_world");
    console.log("Baseline saved; startup confirmation sent.");
    return;
  }

  const restocked = products.filter(
    (p) => prev[p.id] && prev[p.id] !== "in_stock" && p.availability === "in_stock",
  );

  // After Dark first so the important ones lead.
  restocked.sort((a, b) => Number(b.isAfterDark) - Number(a.isAfterDark));

  for (const p of restocked) {
    const flag = p.isAfterDark ? "⭐ AFTER DARK: " : "";
    // Template body params: {{1}} product, {{2}} price · stock, {{3}} url
    await sendTemplate(WA_TEMPLATE, [
      `${flag}${p.name}`,
      `${peso(p.price)} · ${p.stock} left`,
      p.url,
    ]);
    console.log("Alerted restock:", p.name);
    await sleep(2000);
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
