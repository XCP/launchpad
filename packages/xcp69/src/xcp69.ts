/**
 * XCP-69: the one launch standard this site surfaces. See docs/xcp-69.md.
 *
 * All quantities are raw integer satoshi units (×1e8) exactly as the
 * Counterparty API returns them. Core 11.3+ also exposes normalized display
 * companions under `verbose=true`, but standard math stays raw so conformance
 * comparisons remain exact and event/mempool ingestion uses the same shape.
 */

import { big, type Raw, type RawLike, ratio, rawEquals } from "./numeric";

/** Issued supply that remains economically reachable. Sending tokens to
 * Counterparty's canonical unspendable address does not reduce the protocol's
 * issued-supply field, so market-cap and display math subtract that balance
 * explicitly. Clamp protects a stale or malformed upstream value from making
 * supply negative. */
export function circulatingSupplyRaw(total: RawLike, burned: RawLike): bigint {
  const remaining = big(total) - big(burned);
  return remaining > 0n ? remaining : 0n;
}

/**
 * Fairminter record fields the standard cares about. Quantities are
 * {@link Raw} (u64; values past 2^53 arrive as strings — see lib/numeric.ts).
 * Block indices stay numbers: counts, nowhere near the boundary.
 */
export interface Fairminter {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  source: string;
  asset: string;
  asset_longname: string | null;
  description: string;
  /** "text/plain" for a hosted-JSON-URL description; the real content type
   *  (e.g. "image/png") when the description is an inscribed image.
   *  Optional: the D1-indexed listing path doesn't store it. */
  mime_type?: string;
  price: Raw;
  quantity_by_price: Raw;
  hard_cap: Raw;
  soft_cap: Raw;
  soft_cap_deadline_block: number;
  start_block: number;
  end_block: number;
  burn_payment: boolean;
  max_mint_per_tx: Raw;
  max_mint_per_address: Raw | null;
  premint_quantity: Raw;
  minted_asset_commission_int: Raw | null;
  lock_description: boolean;
  lock_quantity: boolean;
  divisible: boolean;
  pool_quantity: Raw | null;
  lp_asset: string | null;
  status: string;
  earned_quantity: Raw | null;
  paid_quantity: Raw | null;
  confirmed?: boolean;
}

export const XCP69 = {
  /**
   * 100M supply. 10^16 is exactly representable but above 2^53 — the
   * integers beside it are not. Compare/compose via {@link XCP69_EXACT}.
   */
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
 * The standard's constants as exact integers — what conformance tests
 * against and what the create flow composes. At HARD_CAP's magnitude the
 * double gap is 2, so an off-by-one record would pass an `===` check on the
 * parsed numbers; exact equality requires the digits.
 */
export const XCP69_EXACT = {
  HARD_CAP: 10_000_000_000_000_000n,
  SOFT_CAP: 6_900_000_000_000_000n,
  POOL_QUANTITY: 3_100_000_000_000_000n,
  QUANTITY_BY_PRICE: 100_000_000_000n,
  PRICE: 1_000_000n,
  MAX_MINT_PER_ADDRESS: 100_000_000_000_000n,
  MAX_MINT_PER_TX: 100_000_000_000_000n,
} as const;

/**
 * Unconfirmed transactions carry this sentinel as block_index
 * (core config.MEMPOOL_BLOCK_INDEX); timing clauses that compare against the
 * confirmation block are meaningless until the launch confirms.
 */
export const MEMPOOL_BLOCK_INDEX = 9_999_999;

/** Derived, exact: 690 XCP raised on success (raw sats). */
export const XCP69_RAISE_SATS =
  (XCP69.SOFT_CAP / XCP69.QUANTITY_BY_PRICE) * XCP69.PRICE;

/** Derived: minimum distinct minting addresses for a launch to succeed. */
export const XCP69_MIN_PARTICIPANTS = XCP69.SOFT_CAP / XCP69.MAX_MINT_PER_ADDRESS; // 69

/** Derived: pool opens at soft_cap/pool_quantity × mint price ≈ 2.23×. */
export const XCP69_OPENING_MULTIPLE = XCP69.SOFT_CAP / XCP69.POOL_QUANTITY;

/**
 * How many lots one address may still mint from a launch, given what it has
 * already committed to that same launch.
 *
 * The cap is per ADDRESS, not per transaction, and the two are equal under
 * this standard (both 1,000,000 tokens) — which is exactly what makes the
 * mistake easy: a second mint looks identical to a legal first one and is
 * rejected only when it confirms. Core checks `already_minted + quantity >
 * max_mint_per_address` and, when it fails, records the fairmint as invalid
 * and returns BEFORE any debit or credit. So the minter keeps their XCP and
 * loses only the Bitcoin fee. Nothing is stolen; a fee is simply burned for
 * nothing, and the failure arrives minutes later with no explanation attached.
 *
 * `alreadyRaw` must include UNCONFIRMED mints, which is the part that is easy
 * to leave out and the part that actually bites. Core validates against the
 * ledger, and the mempool is not the ledger — so two pending mints from one
 * address each report `status: valid` right up until the second one confirms.
 * That is not hypothetical: EVOLVEDPEPE had exactly this pair sitting in the
 * mempool, both at the full cap, both "valid".
 *
 * This is a courtesy, not enforcement. Anyone composing elsewhere bypasses it
 * entirely and the protocol still holds the line. What it buys is a wasted fee
 * not spent, and a limit shown before the money moves rather than after.
 */
export function remainingLotsForAddress(alreadyRaw: bigint): number {
  const remaining = XCP69_EXACT.MAX_MINT_PER_ADDRESS - alreadyRaw;
  if (remaining <= 0n) return 0;
  return Number(remaining / XCP69_EXACT.QUANTITY_BY_PRICE);
}

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
 *   The row's `block_index` only means "the block this was announced in"
 *   while the launch is still pending: core rewrites it to the opening block
 *   the moment minting starts, which would make every properly scheduled
 *   launch fail this clause the instant it opened. Past pending, callers pass
 *   the NEW_FAIRMINTER event's block (fetchOriginalRecord) as announceBlock.
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
export function isXcp69(fm: Fairminter, announceBlock?: number | null): boolean {
  return xcp69Params(fm) && announcedBeforeStart(fm, announceBlock);
}

/**
 * Everything the standard fixes except the pre-announcement clause — all of
 * it readable from the row itself. Timing needs the creation event, which is
 * a request per launch, so callers filter on this first and only look up the
 * few rows that could still qualify.
 */
export function xcp69Params(fm: Fairminter): boolean {
  return (
    (fm.status === "pending" || fm.status === "open" || fm.status === "closed") &&
    rawEquals(fm.pool_quantity, XCP69_EXACT.POOL_QUANTITY) &&
    rawEquals(fm.soft_cap, XCP69_EXACT.SOFT_CAP) &&
    rawEquals(fm.hard_cap, XCP69_EXACT.HARD_CAP) &&
    rawEquals(fm.quantity_by_price, XCP69_EXACT.QUANTITY_BY_PRICE) &&
    rawEquals(fm.price, XCP69_EXACT.PRICE) &&
    rawEquals(fm.max_mint_per_address, XCP69_EXACT.MAX_MINT_PER_ADDRESS) &&
    rawEquals(fm.max_mint_per_tx, XCP69_EXACT.MAX_MINT_PER_TX) &&
    rawEquals(fm.premint_quantity, 0n) &&
    rawEquals(fm.minted_asset_commission_int ?? 0, 0n) &&
    fm.lock_quantity &&
    fm.lock_description &&
    fm.divisible &&
    !fm.burn_payment &&
    !fm.asset.startsWith("A") && // named assets only
    // timing: scheduled start, fixed window, no end_block
    fm.start_block > 0 &&
    fm.end_block === 0 &&
    (fm.status === "closed"
      ? fm.soft_cap_deadline_block <= fm.start_block + XCP69.DEADLINE_BLOCKS
      : fm.soft_cap_deadline_block === fm.start_block + XCP69.DEADLINE_BLOCKS)
  );
}

/**
 * Was this announced strictly before it could be minted? Unconfirmed rows
 * pass on the mempool sentinel; a pending row's own block_index is still the
 * announcement block; anything further along must be judged on the event,
 * and without it the answer is no rather than a guess.
 */
export function announcedBeforeStart(
  fm: Fairminter,
  announceBlock?: number | null,
): boolean {
  if (fm.confirmed === false || fm.block_index >= MEMPOOL_BLOCK_INDEX)
    return true;
  if (fm.status === "pending") return fm.start_block > fm.block_index;
  return announceBlock !== null && announceBlock !== undefined
    ? fm.start_block > announceBlock
    : false;
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

/** Actual destroyed launch supply represented by the canonical burn-address
 * balance. Before graduation, Counterparty parks the fairminter's planned
 * pool allocation at that same address; it becomes the pool reserve on
 * graduation and must not be mistaken for a manual burn. Any balance above
 * that reservation is genuinely unreachable. */
export function netBurnedSupplyRaw(
  burnAddressBalance: RawLike,
  poolQuantity: RawLike,
  phase: LaunchPhase,
): bigint {
  const balance = big(burnAddressBalance);
  const reserved = phase === "graduated" ? 0n : big(poolQuantity);
  const burned = balance - reserved;
  return burned > 0n ? burned : 0n;
}

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
  if (big(fm.pool_quantity) > 0n) return hasPool ? "graduated" : "refunded";
  if (big(fm.soft_cap) > 0n && big(fm.earned_quantity) < big(fm.soft_cap))
    return "refunded";
  return "graduated";
}

/**
 * Record-driven sale target: pool fairminters are all-or-nothing at soft cap;
 * others (non-standard, shown in relaxed mode) fall back to hard cap.
 *
 * Raw, and passed straight through rather than converted: the caller may be
 * about to render it, and a fairminter in relaxed mode can carry a hard cap of
 * 9,223,372,036,854,775,807.
 */
export function saleTarget(fm: Fairminter): Raw {
  return big(fm.soft_cap) > 0n ? fm.soft_cap : fm.hard_cap;
}

/**
 * Sale progress in [0, 1]; earned_quantity is null before the first mint.
 * The fraction fits a double; the operands do not, so divide exactly first.
 */
export function saleProgress(fm: Fairminter): number {
  return ratio(fm.earned_quantity, saleTarget(fm));
}

/** Pool opening multiple over mint price, from the record; null if no pool. */
export function openingMultiple(fm: Fairminter): number | null {
  if (big(fm.pool_quantity) <= 0n || big(fm.soft_cap) <= 0n) return null;
  return ratio(fm.soft_cap, fm.pool_quantity);
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
