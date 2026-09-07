/** Display helpers. Raw satoshi quantities in, human strings out. */

import {
  approx,
  formatExact,
  type RawLike,
  rawToDecimalString,
  SATS,
} from "@/lib/numeric";
import { makeT, type T } from "@/lib/i18n/t";

/** `t` for callers that have no locale: the English source text itself. */
const ENGLISH: T = makeT({});


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

/** Grouped raw quantity padded to its full precision for aligned tables. */
export function fixedRaw(raw: RawLike | null | undefined, decimals = 8): string {
  return formatExact(rawToDecimalString(raw, decimals), {
    minimumFractionDigits: Math.max(decimals, 0),
    maximumFractionDigits: Math.max(decimals, 0),
  });
}

/** Sub-cent-safe price formatting with significant digits. */
export function price(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

/**
 * A fee rate in sat/vB.
 *
 * Rates are fractional now — mempool.space's precise estimates and
 * Counterparty's sat_per_vbyte both carry decimals, and rounding them away was
 * costing real fee. But the raw double is not a thing to show a person:
 * 1.5620000000000003 is the same rate as 1.56 and reads as a bug. Two decimals
 * is finer than any fee decision anyone makes, and whole rates still print
 * whole — 2, not 2.00.
 */
export function satsPerVb(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * How a currency is written: what goes before the number, what goes after,
 * and whether it has minor units at all. Read once per currency from Intl,
 * so "CHF 1.00" and "¥1" and "$1.00" all come out the way Intl would write
 * them, with our own compaction of the number in the middle.
 */
interface CurrencyShape {
  prefix: string;
  suffix: string;
  /** 0 for yen and won; 2 for almost everything else. */
  minor: number;
}

const SHAPES = new Map<string, CurrencyShape>();

/** The Intl locale a page's numbers are written in. Japanese pages use
 *  Japan's own conventions — the fullwidth ￥ and 万/億 groupings — and
 *  everything else uses the English ones, so a page never mixes two. */
function intlLocale(locale: string): string {
  return locale === "ja" ? "ja-JP" : "en-US";
}

function currencyShape(code: string, locale = "en"): CurrencyShape {
  const key = `${locale}:${code}`;
  const cached = SHAPES.get(key);
  if (cached) return cached;
  let shape: CurrencyShape;
  try {
    const formatter = new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: code });
    const parts = formatter.formatToParts(1234.5);
    const first = parts.findIndex((p) => p.type === "integer");
    let last = parts.length - 1;
    while (last > first && !["integer", "group", "decimal", "fraction"].includes(parts[last]!.type)) {
      last -= 1;
    }
    shape = {
      prefix: parts.slice(0, first).map((p) => p.value).join(""),
      suffix: parts.slice(last + 1).map((p) => p.value).join(""),
      minor: formatter.resolvedOptions().maximumFractionDigits ?? 2,
    };
  } catch {
    shape = { prefix: `${code} `, suffix: "", minor: 2 };
  }
  SHAPES.set(key, shape);
  return shape;
}

/**
 * Money display in any currency: compact for big figures, minor units only
 * where they matter, and none at all for currencies that have none. The
 * amount is already in `code` — conversion happens before this, in
 * `useFiat` — so this is purely how the number is written.
 *
 * Japanese pages compact the Japanese way. CoinMarketCap and CoinGecko's
 * Japanese editions write 時価総額 as 1,920万 and 12.4億, never 19.2M, and a
 * reader who thinks in 万 has to convert K/M/B in their head. Intl knows the
 * groupings, so the locale decides: 万/億/兆 in Japanese, K/M/B elsewhere.
 * XCP and token amounts stay K/M everywhere — those are tickers' units, and
 * the same on every exchange.
 */
export function fiat(n: number, code: string, locale = "en"): string {
  const { prefix, suffix, minor } = currencyShape(code, locale);
  const wrap = (body: string) => `${prefix}${body}${suffix}`;
  if (locale === "ja" && n >= 10_000) {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: n >= 100_000_000 ? 2 : 1,
    }).format(n);
  }
  if (n >= 1000) return wrap(compact(n));
  if (n >= 100 || (n >= 1 && minor === 0)) return wrap(String(Math.round(n)));
  if (n >= 1) return wrap(n.toFixed(2));
  return wrap(n.toLocaleString("en-US", { maximumSignificantDigits: 2 }));
}

/** USD display: compact for big figures, cents only where they matter.
 *  `fiat` fixed at dollars; components that should follow the visitor's
 *  currency use `useFiat` from lib/currency instead. */
export function usd(n: number): string {
  return fiat(n, "USD");
}

export function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

/** ~10 minute blocks → human duration. */
/**
 * A span of blocks as a compact duration: 40m, 7h, 3d. Ten minutes a block.
 *
 * Takes the page's `t` so the unit reads in the visitor's language — "3日"
 * rather than "3d" — and defaults to English for callers with no locale to
 * hand (scripts, tests). The digits stay Latin everywhere by design.
 */
export function blocksDuration(blocks: number, t: T = ENGLISH): string {
  const minutes = Math.max(0, blocks) * 10;
  if (minutes < 60) return t("{n}m", { n: minutes });
  const hours = minutes / 60;
  if (hours < 48) return t("{n}h", { n: Math.round(hours) });
  return t("{n}d", { n: Math.round(hours / 24) });
}

/** The same span as an estimate: ~40m, ~7h, ~3d, or "now" once it has passed. */
export function blocksEta(blocks: number, t: T = ENGLISH): string {
  if (blocks <= 0) return t("now");
  return t("~{duration}", { duration: blocksDuration(blocks, t) });
}
