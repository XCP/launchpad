/** Display helpers. Raw satoshi quantities in, human strings out. */

import {
  approx,
  formatExact,
  type RawLike,
  rawToDecimalString,
  SATS,
} from "@/lib/numeric";


/**
 * Raw units as a whole-unit number. Lossy above 2^53 raw units; only for
 * approximate consumers (progress bars, USD estimates, {@link compact}).
 * Digit-exact display goes through {@link commasRaw}.
 */
export function fromSats(raw: RawLike | null | undefined): number {
  return approx(raw) / SATS;
}

/**
 * Whole-unit number respecting divisibility (divisible = ×1e8 raw). Only for
 * approximate consumers such as {@link compact}.
 */
export function tokenQty(raw: RawLike | null | undefined, divisible: boolean): number {
  return divisible ? fromSats(raw) : approx(raw);
}

/** 1234567.89 → "1.23M"; keeps small numbers plain. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  // Round tokens are the common case here (100M supply, 31M pool, 1M cap),
  // and "100.00M" reads as false precision — keep decimals only when they
  // carry a digit.
  const scaled = (value: number, suffix: string) =>
    `${Number(value.toFixed(2)).toLocaleString("en-US", {
      maximumFractionDigits: 2,
    })}${suffix}`;
  if (abs >= 1e12) return scaled(n / 1e12, "T");
  if (abs >= 1e9) return scaled(n / 1e9, "B");
  if (abs >= 1e6) return scaled(n / 1e6, "M");
  if (abs >= 1e3) return scaled(n / 1e3, "K");
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Grouped display of a number that has already been divided down. */
export function commas(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/**
 * Grouped display of a RAW quantity — the exact counterpart of
 * `commas(x / 1e8)`. Divides in integer arithmetic and hands the decimal
 * string to Intl unconverted, which formats strings exactly but numbers only
 * to double precision. Pass `decimals: 0` for indivisible assets.
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
