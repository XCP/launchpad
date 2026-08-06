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
  /** 0.01 XCP per lot */
  PRICE: 1_000_000,
  /** 1M tokens = 10 XCP per address; 69M ÷ 1M = 69 minimum participants */
  MAX_MINT_PER_ADDRESS: 100_000_000_000_000,
  MAX_MINT_PER_TX: 100_000_000_000_000,
  /** Mint window: soft_cap_deadline_block − start_block, exactly (~7 days) */
  DEADLINE_BLOCKS: 1_000,
} as const;

/**
 * Unconfirmed transactions carry this sentinel as block_index
 * (core config.MEMPOOL_BLOCK_INDEX); timing clauses that compare against the
 * confirmation block are meaningless until the launch confirms.
 */
const MEMPOOL_BLOCK_INDEX = 9_999_999;

/** Derived, exact: 690 XCP raised on success (raw sats). */
export const XCP69_RAISE_SATS =
  (XCP69.SOFT_CAP / XCP69.QUANTITY_BY_PRICE) * XCP69.PRICE;

/** Derived: minimum distinct minting addresses for a launch to succeed. */
export const XCP69_MIN_PARTICIPANTS = XCP69.SOFT_CAP / XCP69.MAX_MINT_PER_ADDRESS; // 69

/** Derived: pool opens at soft_cap/pool_quantity × mint price ≈ 2.23×. */
export const XCP69_OPENING_MULTIPLE = XCP69.SOFT_CAP / XCP69.POOL_QUANTITY;

/**
 * The site's editorial policy as a predicate: exact equality against the
 * standard's fixed values. Core has no on-chain standard marker.
 *
 * The commission clause is load-bearing: the protocol permits skimming up to
 * 99% of every mint to the issuer — a premine with extra steps — and no other
 * clause catches it. max_mint_per_tx is equally load-bearing: without it, a
 * launch could conform on every other field while forcing one lot per
 * transaction (1,000 txs per participant).
 *
 * Timing clauses are the two deliberate departures from pure equality:
 *
 * - Pre-announcement (`start_block > block_index`): consensus does NOT require
 *   a future start — a fairminter confirming at or past its start_block just
 *   opens instantly (core fairminter.py parse). Requiring confirmation
 *   strictly before start_block makes every listed launch verifiably
 *   announced on-chain before minting could begin: consensus rejects fairmints
 *   while status is "pending", so the announcement window is mint-proof.
 *   An inequality is unavoidable — composers cannot know their confirmation
 *   block in advance, so no exact lead time is composable.
 *
 * - Window (`soft_cap_deadline_block` vs `start_block + DEADLINE_BLOCKS`):
 *   exact equality while pending/open. Once closed, core may have REWRITTEN
 *   soft_cap_deadline_block to the sell-out block (fairmint.py
 *   _handle_hard_cap_reached defers pool creation to end-of-block by pulling
 *   the deadline forward), so for closed records the field holds the
 *   settlement block and the check relaxes to <=. A short-windowed launch
 *   could in principle slip through this clause after graduating — but it
 *   would have failed the exact check during its entire open phase and so
 *   was never listed while mintable. Call sites close even that gap with
 *   windowIsExact() against the immutable NEW_FAIRMINTER event.
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
    fm.max_mint_per_tx === XCP69.MAX_MINT_PER_TX &&
    fm.premint_quantity === 0 &&
    (fm.minted_asset_commission_int ?? 0) === 0 &&
    fm.lock_quantity &&
    fm.lock_description &&
    fm.divisible &&
    !fm.burn_payment &&
    !fm.asset.startsWith("A") && // named assets only
    // timing: scheduled start, fixed window, no end_block
    fm.start_block > 0 &&
    fm.end_block === 0 &&
    (fm.confirmed === false ||
      fm.block_index >= MEMPOOL_BLOCK_INDEX ||
      fm.start_block > fm.block_index) &&
    (fm.status === "closed"
      ? fm.soft_cap_deadline_block <= fm.start_block + XCP69.DEADLINE_BLOCKS
      : fm.soft_cap_deadline_block === fm.start_block + XCP69.DEADLINE_BLOCKS)
  );
}

/**
 * Exact window verification for closed launches. The fairminters row can't
 * prove the composed window once closed (see the rewrite note on isXcp69),
 * but the NEW_FAIRMINTER event recorded at creation is append-only — pass
 * its soft_cap_deadline_block (fetchOriginalDeadline) to restore exact
 * equality and close the post-graduation short-window loophole.
 */
export function windowIsExact(
  fm: Fairminter,
  originalDeadline: number | null,
): boolean {
  return originalDeadline === fm.start_block + XCP69.DEADLINE_BLOCKS;
}

export type LaunchPhase = "scheduled" | "minting" | "graduated" | "refunded";

/**
 * Lifecycle bucket. For pool fairminters, "graduated" requires confirming the
 * pool exists because success and failure both end at status "closed" —
 * callers pass whether a TOKEN/XCP pool row exists. Classic (non-pool)
 * fairminters, visible only in relaxed mode, succeed by meeting their soft
 * cap (or having none): a minted-out classic close is a success, not a
 * refund.
 */
export function launchPhase(fm: Fairminter, hasPool: boolean): LaunchPhase {
  if (fm.status === "pending") return "scheduled";
  if (fm.status === "open") return "minting";
  if ((fm.pool_quantity ?? 0) > 0) return hasPool ? "graduated" : "refunded";
  if (fm.soft_cap > 0 && (fm.earned_quantity ?? 0) < fm.soft_cap) return "refunded";
  return "graduated";
}

/**
 * Record-driven sale target: pool fairminters are all-or-nothing at soft cap;
 * others (non-standard, shown in relaxed mode) fall back to hard cap.
 */
export function saleTarget(fm: Fairminter): number {
  return fm.soft_cap > 0 ? fm.soft_cap : fm.hard_cap;
}

/** Sale progress in [0, 1]; earned_quantity is null before the first mint. */
export function saleProgress(fm: Fairminter): number {
  const target = saleTarget(fm);
  return target > 0 ? (fm.earned_quantity ?? 0) / target : 0;
}

/** Pool opening multiple over mint price, from the record; null if no pool. */
export function openingMultiple(fm: Fairminter): number | null {
  if (!fm.pool_quantity || fm.pool_quantity <= 0 || fm.soft_cap <= 0) return null;
  return fm.soft_cap / fm.pool_quantity;
}

/**
 * LP asset name, house format: an 18-digit numeric asset that starts with 69,
 * ends with 69, and — the handshake — is ≡ 69 (mod 97). Verifiable with one
 * modulo (see isHouseLpName); 97 is the largest prime under 100, so the
 * congruence catches any single-digit typo or transposition, IBAN-style.
 *
 * The 14 middle digits are random (~10^12 after the congruence adjustment):
 * enough that pre-issuing the namespace to grief launches costs millions in
 * transaction fees (numeric issuance is free, but each squat is a real tx;
 * the unissued check happens at parse). ~10^12 of these names exist.
 *
 * House style is branding, not conformance: isXcp69 does not test it, and a
 * launch composed elsewhere with any unissued numeric lp_asset is still
 * XCP-69.
 */
export function generateLpAssetName(): string {
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let mid = 0n;
  for (const b of bytes) mid = mid * 10n + BigInt(b % 10);
  const n = 69n * 10n ** 16n + mid * 100n + 69n;
  // Stepping mid by 1 moves n by 100 ≡ 3 (mod 97); 65 = 3⁻¹ (mod 97), so one
  // adjustment of at most +96 lands on the target residue.
  const delta = ((((69n - (n % 97n)) % 97n) + 97n) % 97n * 65n) % 97n;
  let mid2 = mid + delta;
  // On overflow past 14 digits, step back 97 instead: 97 mid-steps ≡ 0
  // (mod 97), so the residue is preserved.
  if (mid2 >= 10n ** 14n) mid2 -= 97n;
  return `A${69n * 10n ** 16n + mid2 * 100n + 69n}`;
}

/**
 * The house-format test: starts 69, ends 69, ≡ 69 (mod 97). A random numeric
 * asset passes by accident ~1 in 10^7. Purely informative — anyone can
 * generate passing names, so this identifies the format, not the author.
 */
export function isHouseLpName(name: string | null | undefined): boolean {
  if (!name || !/^A69\d{14}69$/.test(name)) return false;
  return BigInt(name.slice(1)) % 97n === 69n;
}
