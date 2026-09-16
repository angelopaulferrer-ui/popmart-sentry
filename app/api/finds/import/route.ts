import { NextResponse } from "next/server";
import { addSeller } from "@/lib/finds";
import { parseFacebookPost, type ParsedSeller } from "@/lib/finds-parse";
import type { TrustSignals } from "@/lib/finds-types";

export const dynamic = "force-dynamic";

// POST /api/finds/import
//   { text, url?, name?, location?, preview?:true }         -> parse only, return draft
//   { ...draft fields, signals?, save:true }                -> persist as pending seller
//
// The FB paste importer: a human brings a public post; we structure + score it. No FB
// login, no crawling — compliant by construction.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const url = typeof body.url === "string" ? body.url : undefined;

  if (!text.trim() && !url) {
    return NextResponse.json(
      { error: "Paste the post text and/or a post URL." },
      { status: 400 },
    );
  }

  const draft: ParsedSeller = parseFacebookPost({
    text,
    url,
    name: typeof body.name === "string" ? body.name : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
  });

  // Preview mode: return the parsed draft for the human to review/edit.
  if (body.preview) {
    return NextResponse.json({ ok: true, draft });
  }

  // Save mode: merge any human-supplied signals, then persist as pending.
  const signals: TrustSignals = {
    ...draft.signals,
    ...(typeof body.signals === "object" && body.signals ? (body.signals as TrustSignals) : {}),
  };

  const seller = await addSeller({
    name: draft.name,
    handle: draft.handle,
    platform: "facebook",
    profileUrl: draft.profileUrl,
    location: draft.location,
    sellerType: draft.sellerType,
    contact: draft.contact,
    listings: draft.listings,
    signals,
    source: "submission",
    notes: "Imported from Facebook post via paste importer.",
  });

  return NextResponse.json(
    { ok: true, id: seller.id, trustScore: seller.trustScore, trustLevel: seller.trustLevel },
    { status: 201 },
  );
}
