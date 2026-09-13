import { request } from "undici";
import type { Config } from "./config.js";
import type { StockResult } from "./stock.js";

export async function notifyRestock(cfg: Config, result: StockResult): Promise<void> {
  const title = "🟢 Back in stock";
  const line = `${result.product.name}\n${result.product.url}`;
  const text = `${title}: ${line}`;

  // Always log to console.
  console.log(`\n${text}\n`);

  const jobs: Promise<unknown>[] = [];

  if (cfg.discordWebhookUrl) {
    jobs.push(
      post(cfg.discordWebhookUrl, {
        content: text,
      }),
    );
  }

  if (cfg.slackWebhookUrl) {
    jobs.push(
      post(cfg.slackWebhookUrl, {
        text,
      }),
    );
  }

  if (cfg.telegramBotToken && cfg.telegramChatId) {
    const tgUrl = `https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`;
    jobs.push(
      post(tgUrl, {
        chat_id: cfg.telegramChatId,
        text,
        disable_web_page_preview: false,
      }),
    );
  }

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("Notification failed:", r.reason);
    }
  }
}

async function post(url: string, body: unknown): Promise<void> {
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Drain body so the socket is released.
  await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`POST ${url} -> HTTP ${res.statusCode}`);
  }
}
