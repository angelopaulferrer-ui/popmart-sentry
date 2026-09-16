import { NextResponse } from "next/server";
import {
  addSubmission,
  type Platform,
  type SellerType,
  type SellerContact,
} from "@/lib/finds";

export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = [
  "carousell",
  "shopee",
  "lazada",
  "ebay",
  "facebook",
  "instagram",
  "tiktok",
  "website",
  "other",
];
const SELLER_TYPES: SellerType[] = ["official", "supplier", "reseller", "preorder", "unknown"];

function str(v: unknown, max = 300): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

// POST /api/finds/submit — community/seller submission → pending queue.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = str(body.name, 120);
  const platform = str(body.platform) as Platform | undefined;

  if (!name) return NextResponse.json({ error: "Seller name is required." }, { status: 400 });
  if (!platform || !PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "A valid platform is required." }, { status: 400 });
  }

  const contactIn = (body.contact ?? {}) as Record<string, unknown>;
  const contact: SellerContact = {
    shopUrl: str(contactIn.shopUrl),
    messenger: str(contactIn.messenger),
    whatsapp: str(contactIn.whatsapp, 40),
    viber: str(contactIn.viber, 40),
    email: str(contactIn.email, 120),
    phone: str(contactIn.phone, 40),
  };

  // Require at least one way to reach the seller.
  const hasContact = Object.values(contact).some(Boolean) || str(body.profileUrl);
  if (!hasContact) {
    return NextResponse.json(
      { error: "Add at least one contact link, shop URL, or profile URL." },
      { status: 400 },
    );
  }

  const sellerTypeRaw = str(body.sellerType) as SellerType | undefined;
  const sellerType: SellerType =
    sellerTypeRaw && SELLER_TYPES.includes(sellerTypeRaw) ? sellerTypeRaw : "unknown";

  const submission = await addSubmission({
    name,
    platform,
    profileUrl: str(body.profileUrl),
    location: str(body.location, 120),
    sellerType,
    contact,
    sampleListingUrl: str(body.sampleListingUrl),
    note: str(body.note, 500),
  });

  return NextResponse.json({ ok: true, id: submission.id }, { status: 201 });
}
