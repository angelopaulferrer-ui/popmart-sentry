// Hirono Finds — pure types, trust scoring, and view helpers.
//
// No Node-only imports here: this module is safe to import from client components.
// The fs-backed data access lives in lib/finds.ts (server only).

export type Platform =
  | "carousell"
  | "shopee"
  | "lazada"
  | "ebay"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "website"
  | "other";

export type SellerType =
  | "official"
  | "supplier"
  | "reseller"
  | "preorder"
  | "unknown";

export type SellerSource = "aggregated" | "submission" | "manual";
export type SellerStatus = "live" | "pending" | "rejected";
export type TrustLevel = "verified" | "trusted" | "unrated" | "caution";

export interface HironoListing {
  title: string;
  /** e.g. "After Dark", "City of Night", "Little Mischief" */
  series?: string;
  priceMin?: number;
  priceMax?: number;
  currency: string;
  image?: string;
  url?: string;
  inStock?: boolean;
  postedAt?: string;
}

/** Public, checkable signals used to score legitimacy — never private data. */
export interface TrustSignals {
  /** How long the account/shop has existed, in months. */
  accountAgeMonths?: number;
  followers?: number;
  /** Number of ratings/reviews the seller has received. */
  ratingCount?: number;
  /** Average rating, 0..5. */
  ratingAvg?: number;
  /** Platform "verified"/"preferred"/"mall" badge. */
  marketplaceVerified?: boolean;
  completedSales?: number;
  /** 0..1 — how reliably the seller replies. */
  responseRate?: number;
  hasReturnPolicy?: boolean;
}

export interface SellerContact {
  messenger?: string;
  whatsapp?: string;
  viber?: string;
  email?: string;
  phone?: string;
  shopUrl?: string;
}

export interface HironoSeller {
  id: string;
  name: string;
  handle?: string;
  platform: Platform;
  profileUrl?: string;
  /** e.g. "Metro Manila, PH" */
  location?: string;
  sellerType: SellerType;
  contact: SellerContact;
  avatar?: string;
  listings: HironoListing[];
  signals: TrustSignals;
  /** 0..100, computed by scoreTrust(). */
  trustScore: number;
  trustLevel: TrustLevel;
  source: SellerSource;
  status: SellerStatus;
  addedAt: string;
  lastSeen?: string;
  notes?: string;
}

/** What /finds/submit posts. Trust is scored server-side; never trust client scores. */
export interface SellerSubmission {
  id: string;
  name: string;
  platform: Platform;
  profileUrl?: string;
  location?: string;
  sellerType: SellerType;
  contact: SellerContact;
  sampleListingUrl?: string;
  note?: string;
  submittedAt: string;
  status: SellerStatus; // always "pending" on intake
}

// ---------------------------------------------------------------------------
// Trust scoring — the "add only legit sellers" logic.
// Pure + deterministic so the same signals always yield the same score.
// ---------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Score a seller 0..100 from public signals.
 * Weighted so that verifiable marketplace reputation dominates over vanity metrics
 * (followers) that are cheap to fake.
 */
export function scoreTrust(s: TrustSignals): number {
  let score = 0;

  // Marketplace-verified / mall / preferred badge — strongest single signal.
  if (s.marketplaceVerified) score += 25;

  // Rating quality × volume. A 5.0 from 2 buyers ≠ a 4.8 from 400.
  if (s.ratingAvg != null && s.ratingCount != null && s.ratingCount > 0) {
    const quality = clamp((s.ratingAvg - 3.5) / 1.5, 0, 1); // 3.5★=0, 5★=1
    const volume = clamp(Math.log10(s.ratingCount + 1) / 2.5, 0, 1); // ~300 reviews saturates
    score += 30 * quality * (0.4 + 0.6 * volume);
  }

  // Completed sales — proof of real transactions.
  if (s.completedSales != null) {
    score += 15 * clamp(Math.log10(s.completedSales + 1) / 3, 0, 1); // ~1000 sales saturates
  }

  // Account age — sellers that have persisted are less likely to be scams.
  if (s.accountAgeMonths != null) {
    score += 12 * clamp(s.accountAgeMonths / 24, 0, 1); // 2yr saturates
  }

  // Responsiveness + buyer protection.
  if (s.responseRate != null) score += 8 * clamp(s.responseRate, 0, 1);
  if (s.hasReturnPolicy) score += 4;

  // Followers — weakest, capped low because it's the easiest to inflate.
  if (s.followers != null) {
    score += 6 * clamp(Math.log10(s.followers + 1) / 4, 0, 1); // ~10k saturates
  }

  return Math.round(clamp(score, 0, 100));
}

export function trustLevelFor(score: number, signals: TrustSignals): TrustLevel {
  if (score >= 75 && signals.marketplaceVerified) return "verified";
  if (score >= 55) return "trusted";
  if (score >= 35) return "unrated";
  return "caution";
}

/** Recompute + attach trust to a seller record. */
export function withTrust<T extends { signals: TrustSignals }>(seller: T): T & {
  trustScore: number;
  trustLevel: TrustLevel;
} {
  const trustScore = scoreTrust(seller.signals);
  return { ...seller, trustScore, trustLevel: trustLevelFor(trustScore, seller.signals) };
}

// ---------------------------------------------------------------------------
// Small view helpers.
// ---------------------------------------------------------------------------

export const PLATFORM_LABEL: Record<Platform, string> = {
  carousell: "Carousell",
  shopee: "Shopee",
  lazada: "Lazada",
  ebay: "eBay",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  website: "Website",
  other: "Other",
};

export const TRUST_LABEL: Record<TrustLevel, string> = {
  verified: "Verified",
  trusted: "Trusted",
  unrated: "Unrated",
  caution: "Caution",
};
