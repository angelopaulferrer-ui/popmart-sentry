// Hirono Finds — server-only data access (fs-backed for MVP).
//
// Pure types + trust scoring live in lib/finds-types.ts and are re-exported here,
// so server code can `import { ... } from "@/lib/finds"` for everything, while client
// components import the fs-free "@/lib/finds-types".
//
// Sourcing model:
//   - aggregated  : scripts/finds-aggregate.mjs pulls public marketplace listings.
//   - submission  : /finds/submit → pending queue.
//   - manual      : hand-curated.
// Swap the JSON read/write helpers below for Supabase when writes must persist on Vercel.

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  scoreTrust,
  trustLevelFor,
  withTrust,
  type HironoSeller,
  type SellerSubmission,
} from "./finds-types";

export * from "./finds-types";

const DATA_DIR = path.join(process.cwd(), "data");
const SELLERS_FILE = path.join(DATA_DIR, "finds-sellers.json");
const SUBMISSIONS_FILE = path.join(DATA_DIR, "finds-submissions.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** All sellers with trust (re)computed, highest-trust first. */
export async function getSellers(): Promise<HironoSeller[]> {
  const sellers = await readJson<HironoSeller[]>(SELLERS_FILE, []);
  return sellers.map(withTrust).sort((a, b) => b.trustScore - a.trustScore);
}

/** Only sellers safe to show publicly: live + not low-trust. */
export async function getLiveSellers(): Promise<HironoSeller[]> {
  const sellers = await getSellers();
  return sellers.filter((s) => s.status === "live" && s.trustLevel !== "caution");
}

export async function getSeller(id: string): Promise<HironoSeller | undefined> {
  return (await getSellers()).find((s) => s.id === id);
}

/**
 * Add a fully-formed seller record (e.g. from the FB paste importer) to the store.
 * Lands as status:"pending" so nothing goes live un-reviewed. De-dupes on profile URL
 * or platform+name; refreshes listings/signals if the seller already exists.
 */
export async function addSeller(
  input: Omit<HironoSeller, "id" | "trustScore" | "trustLevel" | "status" | "addedAt"> &
    Partial<Pick<HironoSeller, "status">>,
): Promise<HironoSeller> {
  const sellers = await readJson<HironoSeller[]>(SELLERS_FILE, []);
  const keyOf = (s: { profileUrl?: string; platform: string; name: string }) =>
    (s.profileUrl || `${s.platform}:${s.name}`).toLowerCase().replace(/\/+$/, "");

  const trustScore = scoreTrust(input.signals);
  const now = new Date().toISOString();
  const key = keyOf(input);
  const idx = sellers.findIndex((s) => keyOf(s) === key);

  let record: HironoSeller;
  if (idx >= 0) {
    record = {
      ...sellers[idx],
      ...input,
      listings: input.listings.length ? input.listings : sellers[idx].listings,
      trustScore,
      trustLevel: trustLevelFor(trustScore, input.signals),
      status: input.status ?? sellers[idx].status,
      lastSeen: now,
    };
    sellers[idx] = record;
  } else {
    record = {
      ...input,
      id: `imp_${Date.now().toString(36)}_${sellers.length + 1}`,
      trustScore,
      trustLevel: trustLevelFor(trustScore, input.signals),
      status: input.status ?? "pending",
      addedAt: now,
      lastSeen: now,
    };
    sellers.push(record);
  }
  await writeJson(SELLERS_FILE, sellers);
  return record;
}

export async function getSubmissions(): Promise<SellerSubmission[]> {
  return readJson<SellerSubmission[]>(SUBMISSIONS_FILE, []);
}

export async function addSubmission(
  input: Omit<SellerSubmission, "id" | "submittedAt" | "status">,
): Promise<SellerSubmission> {
  const submissions = await getSubmissions();
  const submission: SellerSubmission = {
    ...input,
    id: `sub_${Date.now().toString(36)}_${submissions.length + 1}`,
    submittedAt: new Date().toISOString(),
    status: "pending",
  };
  await writeJson(SUBMISSIONS_FILE, [submission, ...submissions]);
  return submission;
}
