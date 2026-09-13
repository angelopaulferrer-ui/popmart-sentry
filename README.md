# popmart-sentry

Live **availability dashboard** for [Pop Mart Philippines](https://www.popmart.com/ph)
Hirono products — with the **After Dark** series pinned as the priority watch.

Built with Next.js (App Router) + Tailwind. No headless browser at runtime: it
calls Pop Mart's own public APAC API directly.

## What it shows

- Every Hirono product on popmart.com/ph with a live **In stock / Sold out /
  Upcoming** status and remaining stock count.
- **After Dark** items highlighted and sorted to the top.
- Summary stats (in stock, sold out, After Dark in stock) and quick filters.
- **Auto-refresh** every 60s, a manual refresh, and optional **browser restock
  alerts** that fire the moment an item flips back into stock.

## Data source

Discovered by capturing the storefront's own network calls (`scripts/discover*.mjs`).
Two public oRPC endpoints on `prod-apac-api.popmart.com`, sent with an `x-area: PH`
header:

| Endpoint | Purpose |
| --- | --- |
| `POST /rpc/search/public_search` | list products for a keyword (`hirono`) |
| `POST /rpc/ec/spu/public_FindOne` | per-product detail incl. per-SKU `tmpStock` |

Availability = sum of `tmpStock` across a product's SKUs (`> 0` → in stock),
gated by `publish`/`show` and the `saleStartAt` timestamp. See `lib/popmart.ts`.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
# or
npm run build && npm run start
```

`GET /api/scan?q=hirono` returns the raw JSON scan if you want to wire your own
alerting (cron, Discord/Telegram webhook, etc.).

## Notes

- Stock reflects Pop Mart's reported inventory and can lag the live cart.
- To watch a different IP/series, change the keyword passed to `scanHirono`
  (in `app/page.tsx` and `app/api/scan/route.ts`) — the pipeline is generic.
- Deploys cleanly to Vercel. For persistent restock history/alerts across
  serverless invocations, back it with a store (Supabase / Vercel KV) and hit
  `/api/scan` from a cron — currently restock detection is per-open-session.
```
