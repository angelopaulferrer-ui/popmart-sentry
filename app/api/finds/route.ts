import { NextResponse } from "next/server";
import { getLiveSellers } from "@/lib/finds";

export const dynamic = "force-dynamic";

// GET /api/finds — public, vetted seller directory as JSON.
export async function GET() {
  const sellers = await getLiveSellers();
  return NextResponse.json({ count: sellers.length, sellers });
}
