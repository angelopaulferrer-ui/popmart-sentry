import { readFile } from "node:fs/promises";

export interface WatchProduct {
  name: string;
  url: string;
  enabled?: boolean;
}

export interface Config {
  pollIntervalSeconds: number;
  userAgent: string;
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  products: WatchProduct[];
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export async function loadConfig(watchlistPath = "watchlist.json"): Promise<Config> {
  let products: WatchProduct[] = [];
  try {
    const raw = await readFile(watchlistPath, "utf8");
    const parsed = JSON.parse(raw) as { products?: WatchProduct[] };
    products = (parsed.products ?? []).filter((p) => p.enabled !== false);
  } catch (err) {
    throw new Error(`Could not read ${watchlistPath}: ${(err as Error).message}`);
  }

  return {
    pollIntervalSeconds: Number(env("POLL_INTERVAL_SECONDS") ?? 300),
    userAgent: env("USER_AGENT") ?? "popmart-sentry/0.1",
    discordWebhookUrl: env("DISCORD_WEBHOOK_URL"),
    slackWebhookUrl: env("SLACK_WEBHOOK_URL"),
    telegramBotToken: env("TELEGRAM_BOT_TOKEN"),
    telegramChatId: env("TELEGRAM_CHAT_ID"),
    products,
  };
}
