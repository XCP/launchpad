/** Display helpers. Raw satoshi quantities in, human strings out. */

import {
  approx,
  formatExact,
  type RawLike,
  rawToDecimalString,
  SATS,
} from "@/lib/numeric";
import { isLocale, LOCALE_INFO } from "@/lib/i18n/locales";
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

/**
 * 1234567.89 → "1.23M"; keeps small numbers plain.
 *
 * The K/M/B suffixes stay Latin in every language — they are the units a
 * ticker is quoted in, and 万/億 belongs to money rather than to token
 * counts (see {@link fiat}). What follows the locale is the decimal mark:
 * a French reader reads "1,23M", not "1.23M".
 */
export function compact(n: number, locale = "en"): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  // Round tokens are the common case here (100M supply, 31M pool, 1M cap),
  // and "100.00M" reads as false precision — keep decimals only when they
  // carry a digit.
  const scaled = (value: number, suffix: string) =>
    `${Number(value.toFixed(2)).toLocaleString(intlLocale(locale), {
      maximumFractionDigits: 2,
    })}${suffix}`;
  if (abs >= 1e12) return scaled(n / 1e12, "T");
  if (abs >= 1e9) return scaled(n / 1e9, "B");
  if (abs >= 1e6) return scaled(n / 1e6, "M");
  if (abs >= 1e3) return scaled(n / 1e3, "K");
  return n.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 });
}

/** Grouped display of a number that has already been divided down. */
export function commas(n: number, locale = "en"): string {
  return n.toLocaleString(intlLocale(locale), { maximumFractionDigits: 8 });
}

/**
 * Grouped display of a RAW quantity — the exact counterpart of
 * `commas(x / 1e8)`. Divides in integer arithmetic and hands the decimal
 * string to Intl unconverted, which formats strings exactly but numbers only
 * to double precision. Pass `decimals: 0` for indivisible assets.
 */
export function commasRaw(raw: RawLike | null | undefined, decimals = 8, locale = "en"): string {
  return formatExact(rawToDecimalString(raw, decimals), {
    maximumFractionDigits: Math.max(decimals, 0),
  }, intlLocale(locale));
}

/** Grouped raw quantity padded to its full precision for aligned tables. */
export function fixedRaw(raw: RawLike | null | undefined, decimals = 8, locale = "en"): string {
  return formatExact(rawToDecimalString(raw, decimals), {
    minimumFractionDigits: Math.max(decimals, 0),
    maximumFractionDigits: Math.max(decimals, 0),
  }, intlLocale(locale));
}

/**
 * A number to an exact number of decimal places, grouped.
 *
 * The shape that was being hand-written all over the app: the minimum and
 * maximum fraction digits set to the same value. {@link commas} caps at eight
 * places and drops the ones it does not need, which is right for a quantity
 * and wrong for a column — 1.5 beside 1.50 reads as two different
 * measurements taken to different precisions.
 */
export function fixed(n: number, places = 2, locale = "en"): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(intlLocale(locale), {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Sub-cent-safe price formatting with significant digits. */
export function price(n: number, locale = "en"): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString(intlLocale(locale), { maximumFractionDigits: 4 });
  return n.toLocaleString(intlLocale(locale), { maximumSignificantDigits: 4 });
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
export function satsPerVb(n: number, locale = "en"): string {
  return n.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 });
}

/**
 * A ratio written as a percentage: 0.123 -> "12.3%", "12,3 %" in French.
 *
 * Take the ratio, not the already-multiplied number, so that Intl can place
 * the sign the way the language does. Among our locales only French and
 * Russian separate it from the digits, and none of them move it in front,
 * but Intl is the thing that knows that, not us.
 */
export function percent(
  fraction: number,
  { digits = 1, minDigits = 0, signed = false }: PercentOptions = {},
  locale = "en",
): string {
  if (!Number.isFinite(fraction)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    minimumFractionDigits: minDigits,
    maximumFractionDigits: Math.max(digits, minDigits),
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(fraction);
}

export interface PercentOptions {
  /** Most places to show. A trailing zero is dropped unless `minDigits` asks
   *  for it: a lone figure reads better as "100%" than as "100.0%". */
  digits?: number;
  /** Fewest places to show. A COLUMN of percentages wants this at 1, so that
   *  50% and 49.4% line up instead of reading as two different measures. */
  minDigits?: number;
  /** Prefix a plus on a gain. For a change, not for a share. */
  signed?: boolean;
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

/** The Intl locale a page's numbers are written in: the locale's own
 *  conventions — Japan's fullwidth ￥ and 万/億 groupings, Hong Kong's HK$ —
 *  and the English ones for everything else, so a page never mixes two. */
export function intlLocale(locale: string): string {
  return isLocale(locale) ? LOCALE_INFO[locale].intl : "en-US";
}

/** Whether a locale's readers count in 万/億 rather than K/M/B. */
export function usesMyriads(locale: string): boolean {
  return isLocale(locale) && LOCALE_INFO[locale].myriads;
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
 * Japanese and Chinese pages compact their own way. CoinMarketCap and
 * CoinGecko's Japanese editions write 時価総額 as 1,920万 and 12.4億, never
 * 19.2M, the Chinese editions write 市值 as 1920万 and 12.4亿, and a reader
 * who thinks in 万 has to convert K/M/B in their head. Intl knows the
 * groupings, so the locale decides: 万/億/兆 there, K/M/B elsewhere.
 * XCP and token amounts stay K/M everywhere — those are tickers' units, and
 * the same on every exchange.
 */
export function fiat(n: number, code: string, locale = "en"): string {
  const { prefix, suffix, minor } = currencyShape(code, locale);
  const wrap = (body: string) => `${prefix}${body}${suffix}`;
  if (usesMyriads(locale) && n >= 10_000) {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: n >= 100_000_000 ? 2 : 1,
    }).format(n);
  }
  if (n >= 1000) return wrap(compact(n, locale));
  if (n >= 100 || (n >= 1 && minor === 0)) return wrap(String(Math.round(n)));
  if (n >= 1) return wrap(n.toLocaleString(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }));
  return wrap(n.toLocaleString(intlLocale(locale), { maximumSignificantDigits: 2 }));
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

/**
 * The formatters above, bound to one locale.
 *
 * A number is not language-neutral. "1,234.56" reads as one and a bit to a
 * Brazilian, and French, Russian and Ukrainian group with a space and mark
 * the decimal with a comma. Seven of the site's locales happen to agree with
 * English — Japanese, Korean, all three Chinese and Latin American Spanish
 * all group with commas — so binding changes nothing for them and fixes the
 * four it does not.
 *
 * What deliberately does NOT follow the locale: the K/M/B suffixes, which
 * are the units a ticker is quoted in, and the digits themselves, which stay
 * Western even where a locale has its own numerals.
 *
 * Components reach this through `useNumbers()`, or `getNumbers()` on the
 * server; both are in lib/i18n. It is a plain function so that either side
 * can call it.
 */
export interface Numbers {
  /** 1234567.89 → "1.23M" ("1,23M" where the comma is the decimal mark). */
  compact: (n: number) => string;
  /** Grouped display of an already-divided number. */
  commas: (n: number) => string;
  /** Grouped display of a RAW quantity, exact to its last satoshi. */
  commasRaw: (raw: RawLike | null | undefined, decimals?: number) => string;
  /** Grouped raw quantity padded to full precision, for aligned columns. */
  fixedRaw: (raw: RawLike | null | undefined, decimals?: number) => string;
  /** A plain number to an exact number of places: 1.5 at 2 places is "1.50". */
  fixed: (n: number, places?: number) => string;
  /** Sub-cent-safe price. */
  price: (n: number) => string;
  /** A fee rate in sat/vB. */
  satsPerVb: (n: number) => string;
  /** A RATIO as a percentage: 0.123 -> "12.3%", "12,3 %" in French. */
  percent: (fraction: number, options?: PercentOptions) => string;
  /** The Intl locale tag behind all of the above, for the few call sites
   *  that need NumberFormat options of their own. */
  intl: string;
}

export function bindNumbers(locale: string): Numbers {
  return {
    compact: (n) => compact(n, locale),
    commas: (n) => commas(n, locale),
    commasRaw: (raw, decimals) => commasRaw(raw, decimals, locale),
    fixedRaw: (raw, decimals) => fixedRaw(raw, decimals, locale),
    fixed: (n, places) => fixed(n, places, locale),
    price: (n) => price(n, locale),
    satsPerVb: (n) => satsPerVb(n, locale),
    percent: (fraction, options) => percent(fraction, options, locale),
    intl: intlLocale(locale),
  };
}
