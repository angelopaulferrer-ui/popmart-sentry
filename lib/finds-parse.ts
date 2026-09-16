// Hirono Finds — Facebook post parser.
//
// Turns a pasted FB post (text + optional URL) into a draft seller record. This is the
// compliant path for Facebook: no login, no crawling, no ToS violation — a human brings
// the public post to us, we structure it. A browser extension can automate the "paste"
// later without ever scraping FB server-side.
//
// Pure module (no Node/fs), so it runs in the API route AND in a live client preview.

import type {
  HironoListing,
  Platform,
  SellerContact,
  SellerType,
  TrustSignals,
} from "./finds-types";

export interface ParsedSeller {
  name: string;
  handle?: string;
  platform: Platform;
  profileUrl?: string;
  location?: string;
  sellerType: SellerType;
  contact: SellerContact;
  listings: HironoListing[];
  signals: TrustSignals;
  /** Fields the parser couldn't fill confidently — surfaced so a human can complete them. */
  warnings: string[];
}

// Known Hirono series/lines — extend as Pop Mart releases more.
const HIRONO_SERIES = [
  "After Dark",
  "City of Night",
  "Little Mischief",
  "Mime",
  "Reload",
  "One Day",
  "Season of Warm",
  "Summer",
  "Mood",
  "Fruits",
  "Reindeer",
];

const clampStr = (s: string, max: number) => s.trim().slice(0, max);

/** Extract PH-style prices: ₱550, P 1,200, PHP1200, 550php. Returns sorted unique numbers. */
function extractPrices(text: string): number[] {
  const out = new Set<number>();
  const patterns = [
    /(?:₱|php|p)\s?([\d,]{2,7})(?:\.\d{1,2})?/gi,
    /([\d,]{2,7})\s?php\b/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 50 && n <= 500000) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function extractSeries(text: string): string[] {
  const lower = text.toLowerCase();
  return HIRONO_SERIES.filter((s) => lower.includes(s.toLowerCase()));
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[0] : undefined;
}

/** Pull whatever public contact points appear in the post text/URL. */
function extractContact(text: string, url?: string): SellerContact {
  const contact: SellerContact = {};

  const mMe = firstMatch(text, /https?:\/\/(?:m\.me|ig\.me)\/[^\s)]+/i);
  if (mMe) contact.messenger = mMe;

  const wa = firstMatch(text, /https?:\/\/wa\.me\/\d+/i);
  if (wa) contact.whatsapp = wa.replace(/\D/g, "");

  const fbUrl =
    url && /facebook\.com|fb\.com|fb\.me/i.test(url)
      ? url
      : firstMatch(text, /https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com|fb\.me)\/[^\s)]+/i);
  if (fbUrl && !contact.messenger) contact.shopUrl = fbUrl;

  const email = firstMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) contact.email = email.toLowerCase();

  // PH mobile / Viber numbers: 09171234567, +639171234567, 0917 123 4567
  const phone = firstMatch(text, /(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/);
  if (phone) {
    if (/viber/i.test(text)) contact.viber = phone.replace(/\s|-/g, "");
    else contact.phone = phone.replace(/\s|-/g, "");
  }

  return contact;
}

function detectSellerType(text: string): SellerType {
  const t = text.toLowerCase();
  if (/\bsupplier|wholesale|bulk\b/.test(t)) return "supplier";
  if (/\b(pre[\s-]?order|preorder|\bpo\b|gpo|group order|\bgo\b)\b/.test(t)) return "preorder";
  if (/\breseller|onhand|on hand|for sale|fs\b|selling\b/.test(t)) return "reseller";
  return "unknown";
}

/** In-stock unless the post is clearly a pre-order / sold-out. */
function detectInStock(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bsold\s?out|sold\b|closed\b|pre[\s-]?order|preorder|\bpo\b\b/.test(t)) return false;
  if (/\bonhand|on hand|available|in stock|ready to ship|rts\b/.test(t)) return true;
  return true;
}

/** Derive a display name + handle from a FB profile/group URL. */
function nameFromUrl(url?: string): { name?: string; handle?: string } {
  if (!url) return {};
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // facebook.com/<slug>, facebook.com/groups/<slug>, facebook.com/profile.php?id=…
    let slug = parts[0] === "groups" ? parts[1] : parts[0];
    if (!slug || slug === "profile.php") return {};
    slug = decodeURIComponent(slug).replace(/[-_.]/g, " ").trim();
    if (!slug) return {};
    const name = slug.replace(/\b\w/g, (c) => c.toUpperCase());
    return { name, handle: `@${parts[0] === "groups" ? parts[1] : parts[0]}` };
  } catch {
    return {};
  }
}

export interface ParseInput {
  text?: string;
  url?: string;
  /** Optional overrides a human supplies alongside the paste. */
  name?: string;
  location?: string;
}

/**
 * Parse a pasted Facebook post into a draft seller. Best-effort: whatever it can't
 * determine confidently goes into `warnings` for a human to fill before publishing.
 */
export function parseFacebookPost(input: ParseInput): ParsedSeller {
  const text = clampStr(input.text ?? "", 8000);
  const url = input.url?.trim() || undefined;
  const warnings: string[] = [];

  const prices = extractPrices(text);
  const series = extractSeries(text);
  const contact = extractContact(text, url);
  const derived = nameFromUrl(url);

  const name = input.name?.trim() || derived.name || "";
  if (!name) warnings.push("Couldn’t detect a seller name — please add one.");
  if (!series.length) warnings.push("No known Hirono series detected in the post.");
  if (!prices.length) warnings.push("No price found in the post.");
  if (!Object.keys(contact).length && !url) {
    warnings.push("No contact link/number found — add how buyers reach them.");
  }

  // Build one representative listing from the post; a human can split it later.
  const listingTitle =
    (series.length ? `Hirono ${series[0]}` : "Hirono") +
    (/\bset\b|full set/i.test(text) ? " — full set" : "");

  const listing: HironoListing = {
    title: clampStr(listingTitle, 140),
    series: series[0],
    priceMin: prices[0],
    priceMax: prices[prices.length - 1],
    currency: "PHP",
    url,
    inStock: detectInStock(text),
  };

  // Facebook signals are weak by design (no marketplace ratings). Anything the human
  // knows (followers, account age) can be added in the review step to lift the score.
  const signals: TrustSignals = {};

  return {
    name: name || "Unknown FB seller",
    handle: derived.handle,
    platform: "facebook",
    profileUrl: url,
    location: input.location?.trim() || undefined,
    sellerType: detectSellerType(text),
    contact,
    listings: [listing],
    signals,
    warnings,
  };
}
