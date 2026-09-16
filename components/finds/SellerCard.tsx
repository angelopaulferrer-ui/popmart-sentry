import type { HironoSeller, TrustLevel } from "@/lib/finds-types";
import { PLATFORM_LABEL, TRUST_LABEL } from "@/lib/finds-types";

const TRUST_STYLE: Record<TrustLevel, string> = {
  verified: "bg-emerald-600 text-white",
  trusted: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  unrated: "bg-amber-100 text-amber-800 ring-1 ring-amber-300",
  caution: "bg-rose-100 text-rose-800 ring-1 ring-rose-300",
};

const SELLER_TYPE_LABEL: Record<HironoSeller["sellerType"], string> = {
  official: "Official",
  supplier: "Supplier",
  reseller: "Reseller",
  preorder: "Pre-order",
  unknown: "Seller",
};

function peso(n?: number) {
  if (n == null) return null;
  return `₱${n.toLocaleString("en-PH")}`;
}

function priceRange(listings: HironoSeller["listings"]) {
  const mins = listings.map((l) => l.priceMin).filter((n): n is number => n != null);
  const maxs = listings.map((l) => l.priceMax ?? l.priceMin).filter((n): n is number => n != null);
  if (!mins.length) return null;
  const lo = Math.min(...mins);
  const hi = Math.max(...maxs);
  return lo === hi ? peso(lo) : `${peso(lo)}–${peso(hi)}`;
}

/** The primary "reach out" link for a seller, best-channel first. */
function primaryContact(s: HironoSeller): { href: string; label: string } | null {
  const c = s.contact;
  if (c.shopUrl) return { href: c.shopUrl, label: "View shop" };
  if (c.messenger) return { href: c.messenger, label: "Message" };
  if (c.whatsapp) return { href: `https://wa.me/${c.whatsapp.replace(/\D/g, "")}`, label: "WhatsApp" };
  if (c.viber) return { href: `viber://chat?number=${encodeURIComponent(c.viber)}`, label: "Viber" };
  if (c.email) return { href: `mailto:${c.email}`, label: "Email" };
  if (s.profileUrl) return { href: s.profileUrl, label: "View profile" };
  return null;
}

export default function SellerCard({ seller }: { seller: HironoSeller }) {
  const range = priceRange(seller.listings);
  const contact = primaryContact(seller);
  const seriesList = Array.from(
    new Set(seller.listings.map((l) => l.series).filter(Boolean)),
  ) as string[];

  return (
    <article className="flex flex-col rounded-2xl bg-[var(--paper-card)] p-4 shadow-sm ring-1 ring-black/5">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[var(--ink)]">{seller.name}</h3>
          <p className="truncate text-sm text-[var(--ink)]/60">
            {PLATFORM_LABEL[seller.platform]}
            {seller.handle ? ` · ${seller.handle}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${TRUST_STYLE[seller.trustLevel]}`}
          title={`Trust score ${seller.trustScore}/100`}
        >
          {TRUST_LABEL[seller.trustLevel]} · {seller.trustScore}
        </span>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ink)]/70">
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium">
          {SELLER_TYPE_LABEL[seller.sellerType]}
        </span>
        {seller.location && <span>📍 {seller.location}</span>}
        {range && <span className="font-medium text-[var(--ink)]">{range}</span>}
      </div>

      {seriesList.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {seriesList.map((s) => (
            <span key={s} className="rounded-md bg-[var(--ink)]/10 px-2 py-0.5 text-xs text-[var(--ink)]/80">
              {s}
            </span>
          ))}
        </div>
      )}

      <ul className="mt-3 space-y-1 text-sm text-[var(--ink)]/80">
        {seller.listings.slice(0, 2).map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.inStock ? "bg-emerald-500" : "bg-amber-400"}`} />
            <span className="truncate">{l.title}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        {contact && (
          <a
            href={contact.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="flex-1 rounded-xl bg-[var(--ink)] px-3 py-2 text-center text-sm font-semibold text-[var(--paper)] transition hover:opacity-90"
          >
            {contact.label}
          </a>
        )}
        {seller.profileUrl && contact?.href !== seller.profileUrl && (
          <a
            href={seller.profileUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink)]/70 ring-1 ring-black/10 transition hover:bg-black/5"
          >
            Profile
          </a>
        )}
      </div>
    </article>
  );
}
