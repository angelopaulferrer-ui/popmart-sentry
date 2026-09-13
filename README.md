# popmart-sentry

Restock monitor for [Pop Mart](https://www.popmart.com) products. Polls product
pages on an interval and alerts you the moment an item flips from sold-out to
buyable — great for chasing Labubu / SKULLPANDA / MOLLY drops.

## How it works

1. You list product URLs in `watchlist.json`.
2. Each cycle, the sentry fetches every enabled page and reads the HTML for
   stock signals (`add to cart`, `sold out`, schema.org `availability`, etc.).
3. When a product transitions **out_of_stock → in_stock**, you get an alert
   (console always; optionally Discord / Slack / Telegram).
4. Last-seen availability is cached in `.state.json` so you only get pinged on
   the actual restock, not every cycle.

## Setup

```bash
npm install
cp .env.example .env      # optional: add webhook / bot tokens
```

Add products to `watchlist.json`:

```json
{
  "products": [
    { "name": "SKULLPANDA — City of Night", "url": "https://www.popmart.com/us/products/xxxx", "enabled": true }
  ]
}
```

## Run

```bash
npm run check     # one pass, print status, exit  (good for cron)
npm run dev       # continuous, hot-reload during development
npm run build && npm start   # continuous, compiled
```

## Alerts

Set any of these in `.env` to fan out restock pings:

- `DISCORD_WEBHOOK_URL`
- `SLACK_WEBHOOK_URL`
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`

## Notes

- Default poll interval is 300s. Keep it polite — hammering the site risks a
  rate-limit or IP block. `POLL_INTERVAL_SECONDS` sets it (min 30s).
- Stock detection is HTML-signal based. If Pop Mart changes markup or a page is
  JS-rendered, tune the signal lists in `src/stock.ts`.
- For scheduled checks without a long-running process, use `npm run check` from
  cron / a scheduled job and rely on `.state.json` for de-duplication.
