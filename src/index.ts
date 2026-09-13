#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { checkStock } from "./stock.js";
import { notifyRestock } from "./notify.js";
import { loadState, saveState } from "./state.js";

const runOnce = process.argv.includes("--once");

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function runCycle(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.products.length === 0) {
    log("No enabled products in watchlist.json — nothing to check.");
    return;
  }

  const state = await loadState();

  for (const product of cfg.products) {
    const result = await checkStock(product, cfg.userAgent);
    const prev = state[product.url] ?? "unknown";
    const now = result.availability;

    log(
      `${product.name}: ${now}${result.note ? ` (${result.note})` : ""}` +
        (prev !== now ? `  [was ${prev}]` : ""),
    );

    // Alert on the transition INTO in_stock from a known non-in_stock state.
    if (now === "in_stock" && prev !== "in_stock") {
      await notifyRestock(cfg, result);
    }

    // Only persist confident readings so a transient "unknown" doesn't erase history.
    if (now !== "unknown") {
      state[product.url] = now;
    }
  }

  await saveState(state);
}

async function main(): Promise<void> {
  const cfg = await loadConfig();
  log(
    `popmart-sentry started — ${cfg.products.length} product(s), ` +
      `every ${cfg.pollIntervalSeconds}s${runOnce ? " (single run)" : ""}`,
  );

  await runCycle();
  if (runOnce) return;

  const intervalMs = Math.max(30, cfg.pollIntervalSeconds) * 1000;
  setInterval(() => {
    runCycle().catch((err) => log(`cycle error: ${(err as Error).message}`));
  }, intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
