import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3600; // IP list rarely changes

// Pop Mart's full IP roster (THE MONSTERS/Labubu, SKULLPANDA, MOLLY, Hirono, …).
export async function GET() {
  try {
    const res = await fetch(
      "https://prod-apac-api.popmart.com/rpc/ip/public_findAllBasicInfo",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-area": "PH",
          "accept-language": "en",
        },
        body: JSON.stringify({ json: {} }),
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return NextResponse.json({ ips: [] });
    const body = (await res.json()) as {
      json?: { items?: { name_trans?: Record<string, string> }[] };
    };
    const ips = (body.json?.items ?? [])
      .map((it) => it.name_trans?.["en-us"] || it.name_trans?.["en"] || "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ ips: [...new Set(ips)] });
  } catch {
    return NextResponse.json({ ips: [] });
  }
}
