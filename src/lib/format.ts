/** Display helpers. Raw satoshi quantities in, human strings out. */

import {
  approx,
  formatExact,
  type RawLike,
  rawToDecimalString,
} from "@/lib/numeric";

const SATS = 1e8;

/**
 * Raw units as a whole-unit number.
 *
 * Lossy above 2^53 raw units (~90M of a divisible asset) and deliberately so:
 * the callers are progress bars, USD estimates, chart geometry and {@link
 * compact}, where a double is the honest answer. Anything a person reads
 * digit-for-digit goes through {@link commasRaw}, which never converts.
 */
export function fromSats(raw: RawLike | null | undefined): number {
  return approx(raw) / SATS;
}

/**
 * Token-quantity display that respects the asset's divisibility: divisible
 * quantities are ×1e8 raw, indivisible ones are whole units already. XCP-69
 * assets are always divisible; this matters for the non-conforming
 * fairminters shown in relaxed mode.
 *
 * A number, because every caller hands the result to {@link compact}, which
 * abbreviates to three significant figures — a precision a double clears by a
 * wide margin even at the u64 ceiling.
 */
export function tokenQty(raw: RawLike | null | undefined, divisible: boolean): number {
  return divisible ? fromSats(raw) : approx(raw);
}

/** 1234567.89 → "1.23M"; keeps small numbers plain. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Grouped display of a number that has already been divided down. */
export function commas(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/**
 * Grouped display of a RAW quantity — the exact counterpart to `commas(x / 1e8)`.
 *
 * The division happens in integer arithmetic and the resulting decimal string
 * reaches Intl untouched. That last part is the whole trick: Intl formats a
 * decimal string exactly and a number only as precisely as a double allows, so
 * a display path must never convert on the way to the formatter. PEPECASH's
 * supply reads 995,269,147.11111111 through the string and 995,269,147.111111
 * through the double.
 *
 * Pass `decimals: 0` for an indivisible asset, whose raw units are whole units.
 */
export function commasRaw(raw: RawLike | null | undefined, decimals = 8): string {
  return formatExact(rawToDecimalString(raw, decimals), {
    maximumFractionDigits: Math.max(decimals, 0),
  });
}

/** Sub-cent-safe price formatting with significant digits. */
export function price(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

/** USD display: compact for big figures, cents only where they matter. */
export function usd(n: number): string {
  if (n >= 1000) return `$${compact(n)}`;
  if (n >= 100) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US", { maximumSignificantDigits: 2 })}`;
}

export function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

/** ~10 minute blocks → human duration. */
export function blocksEta(blocks: number): string {
  if (blocks <= 0) return "now";
  const minutes = blocks * 10;
  if (minutes < 60) return `~${minutes}m`;
  const hours = minutes / 60;
  if (hours < 48) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}
