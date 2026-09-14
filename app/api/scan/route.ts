import { NextResponse } from "next/server";
import { scanIp } from "@/lib/popmart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keyword = url.searchParams.get("q")?.trim() || "Hirono";
  try {
    const result = await scanIp(keyword);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
