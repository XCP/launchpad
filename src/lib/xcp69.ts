/**
 * XCP-69: the one launch standard this site surfaces. See docs/xcp-69.md.
 *
 * All quantities are raw integer satoshi units (×1e8) exactly as the
 * Counterparty API returns them. `pool_quantity` and `max_mint_per_address`
 * have no `_normalized` siblings in the API, so all standard math stays raw.
 */

/** Fairminter record fields the standard cares about (raw units). */
export interface Fairminter {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  source: string;
  asset: string;
  asset_longname: string | null;
  description: string;
  price: number;
  quantity_by_price: number;
  hard_cap: number;
  soft_cap: number;
  soft_cap_deadline_block: number;
  start_block: number;
  end_block: number;
  burn_payment: boolean;
  max_mint_per_tx: number;
  max_mint_per_address: number | null;
  premint_quantity: number;
  minted_asset_commission_int: number | null;
  lock_description: boolean;
  lock_quantity: boolean;
  divisible: boolean;
  pool_quantity: number | null;
  lp_asset: string | null;
  status: string;
  earned_quantity: number | null;
  paid_quantity: number | null;
  confirmed?: boolean;
}

export const XCP69 = {
  /** 100M supply */
  HARD_CAP: 10_000_000_000_000_000,
  /** 69M public sale — reaching it IS selling out (all-or-nothing) */
  SOFT_CAP: 6_900_000_000_000_000,
  /** 31M seeded into the TOKEN/XCP pool at close, LP burned */
  POOL_QUANTITY: 3_100_000_000_000_000,
  /** 1,000-token lots */
  QUANTITY_BY_PRICE: 100_000_000_000,
  /** 0.1 XCP per lot */
  PRICE: 10_000_000,
  /** 690k tokens = 1% of the sale = 69 XCP per address */
  MAX_MINT_PER_ADDRESS: 69_000_000_000_000,
  MAX_MINT_PER_TX: 69_000_000_000_000,
  /** Mint window in blocks (~7 days) */
  DEADLINE_BLOCKS: 1_000,
} as const;

/** Derived, exact: 6,900 XCP raised on success (raw sats). */
export const XCP69_RAISE_SATS =
  (XCP69.SOFT_CAP / XCP69.QUANTITY_BY_PRICE) * XCP69.PRICE;

/** Derived: minimum distinct minting addresses for a launch to succeed. */
export const XCP69_MIN_PARTICIPANTS = XCP69.SOFT_CAP / XCP69.MAX_MINT_PER_ADDRESS; // 100

/** Derived: pool opens at soft_cap/pool_quantity × mint price ≈ 2.23×. */
export const XCP69_OPENING_MULTIPLE = XCP69.SOFT_CAP / XCP69.POOL_QUANTITY;

/**
 * The site's editorial policy as a predicate: exact equality against the
 * standard's fixed values. Core has no on-chain standard marker.
 *
 * The commission clause is load-bearing: the protocol permits skimming up to
 * 99% of every mint to the issuer — a premine with extra steps — and no other
 * clause catches it.
 */
export function isXcp69(fm: Fairminter): boolean {
  return (
    (fm.status === "pending" || fm.status === "open" || fm.status === "closed") &&
    fm.pool_quantity === XCP69.POOL_QUANTITY &&
    fm.soft_cap === XCP69.SOFT_CAP &&
    fm.hard_cap === XCP69.HARD_CAP &&
    fm.quantity_by_price === XCP69.QUANTITY_BY_PRICE &&
    fm.price === XCP69.PRICE &&
    fm.max_mint_per_address === XCP69.MAX_MINT_PER_ADDRESS &&
    fm.premint_quantity === 0 &&
    (fm.minted_asset_commission_int ?? 0) === 0 &&
    fm.lock_quantity &&
    fm.lock_description &&
    fm.divisible &&
    !fm.burn_payment &&
    !fm.asset.startsWith("A") // named assets only
  );
}

export type LaunchPhase = "launching" | "launched" | "refunded";

/**
 * Lifecycle bucket. "Launched" requires confirming the pool exists because
 * success and failure both end at status "closed"; callers pass whether a
 * TOKEN/XCP pool row exists for the asset.
 */
export function launchPhase(fm: Fairminter, hasPool: boolean): LaunchPhase {
  if (fm.status === "pending" || fm.status === "open") return "launching";
  return hasPool ? "launched" : "refunded";
}

/** Sale progress in [0, 1]; earned_quantity is null before the first mint. */
export function saleProgress(fm: Fairminter): number {
  return (fm.earned_quantity ?? 0) / XCP69.SOFT_CAP;
}

/**
 * LP asset name: "A69" + random tail. Brand-consistent but unpredictable —
 * a deterministic tail would let a griefer pre-issue expected names for
 * pennies and invalidate launches (the unissued check happens at parse).
 * "A69" + 16 random digits lands in [6.9e17, 7.0e17), inside the valid
 * numeric range (26^12+1 .. 2^64-1).
 */
export function generateLpAssetName(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (const b of bytes) tail += (b % 10).toString();
  return `A69${tail}`;
}
