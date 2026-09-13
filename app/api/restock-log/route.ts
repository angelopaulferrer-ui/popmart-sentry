import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// The 60s GitHub Action commits restock events to data/restock-log.json.
// We read it from the public repo's raw file so the log updates without redeploys.
const RAW_URL =
  "https://raw.githubusercontent.com/angelopaulferrer-ui/popmart-sentry/main/data/restock-log.json";

export async function GET() {
  try {
    const res = await fetch(RAW_URL, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ events: [] });
    const events = await res.json();
    return NextResponse.json(
      { events: Array.isArray(events) ? events : [] },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ events: [] });
  }
}
