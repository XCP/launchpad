/**
 * Exact integer handling for Counterparty quantities.
 *
 * Quantities are unsigned 64-bit integers; JavaScript numbers are exact only
 * to 2^53-1, and JSON.parse rounds larger literals before application code
 * runs. Observed on this site: TTTTTAAAAAA's hard_cap 9223372036854775807
 * parses to ...776000, and XCP-69's own 10^16 hard cap sits above the safe
 * range (ulp 2) — so a non-conforming value can parse onto the standard's
 * exact value and defeat the isXcp69 equality check.
 *
 * BigInt, not a decimal library: every protocol value is an integer, and
 * BigInt is native and exact. Ratios and percentages are small by
 * construction and stay doubles.
 */

/**
 * A raw quantity as it arrives from {@link parseJsonLossless}: `number`
 * within the safe range, `string` (all digits intact) above it. The union
 * makes the compiler reject bare arithmetic like `total + row.quantity`.
 */
export type Raw = number | string;

/** A raw quantity in any exact form, including bigints this module returns. */
export type RawLike = Raw | bigint;

/** Raw units per whole unit of a divisible asset. */
export const SATS_PER_UNIT = 100_000_000n;

/** Double-arithmetic counterpart of {@link SATS_PER_UNIT}, for approximations. */
export const SATS = 1e8;

/** Basis points in 100% — the denominator for percentage math on bigints. */
const BPS_SCALE = 10_000n;

/** Significant-figure scale for bigint→double ratios (12 digits). */
const RATIO_SCALE = 1_000_000_000_000n;
const RATIO_SCALE_NUM = 1e12;

/* -------------------------------------------------------------------- */
/* Lossless JSON                                                        */
/* -------------------------------------------------------------------- */

/**
 * Rewrite integer literals outside the double-safe range as quoted strings.
 * Walks the text (not a regex) so digits inside string literals are never
 * touched. Fractions and exponents are left alone: they were never exact
 * integers, so quoting would change meaning rather than preserve it.
 */
export function quoteUnsafeIntegers(text: string): string {
  let out = "";
  let i = 0;

  while (i < text.length) {
    const char = text[i]!;

    if (char === '"') {
      const start = i;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      out += text.slice(start, i);
      continue;
    }

    if (char === "-" || (char >= "0" && char <= "9")) {
      const start = i;
      if (text[i] === "-") i += 1;
      while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i += 1;

      let isInteger = true;
      if (i < text.length && (text[i] === "." || text[i] === "e" || text[i] === "E")) {
        isInteger = false;
        while (i < text.length && /[0-9eE+\-.]/.test(text[i]!)) i += 1;
      }

      const literal = text.slice(start, i);
      out += isInteger && !Number.isSafeInteger(Number(literal)) ? `"${literal}"` : literal;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * JSON.parse with integers above 2^53-1 preserved as strings. Throws exactly
 * as JSON.parse does on malformed input.
 */
export function parseJsonLossless<T = unknown>(text: string): T {
  return JSON.parse(quoteUnsafeIntegers(text)) as T;
}

/* -------------------------------------------------------------------- */
/* Exact integer arithmetic                                             */
/* -------------------------------------------------------------------- */

/**
 * Exact bigint from a raw quantity, or null for non-integers, unsafe
 * doubles, and null/undefined (the API returns null quantities on
 * fairminters with no mints).
 */
export function toBigInt(value: RawLike | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return null;
    // An unsafe double no longer identifies a single integer.
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/** {@link toBigInt} with zero substituted for unreadable values. */
export function big(value: RawLike | null | undefined): bigint {
  return toBigInt(value) ?? 0n;
}

/**
 * Exact equality against a known constant. Required by isXcp69: the
 * standard's 10^16 hard cap is above the safe range, so `===` on parsed
 * numbers would accept off-by-one records.
 */
export function rawEquals(value: RawLike | null | undefined, expected: bigint): boolean {
  const exact = toBigInt(value);
  return exact !== null && exact === expected;
}

/** Exact sum over raw quantities. */
export function sumRaw(values: Iterable<RawLike | null | undefined>): bigint {
  let total = 0n;
  for (const value of values) total += big(value);
  return total;
}

/**
 * Sort comparator, largest first. The `b - a` idiom can return 0 for 64-bit
 * quantities that differ.
 */
export function compareRawDesc(
  a: RawLike | null | undefined,
  b: RawLike | null | undefined,
): number {
  const left = big(a);
  const right = big(b);
  return left === right ? 0 : left > right ? -1 : 1;
}

/** Smaller of two raw quantities, exactly. */
export function minRaw(a: RawLike | null | undefined, b: RawLike | null | undefined): bigint {
  const left = big(a);
  const right = big(b);
  return left <= right ? left : right;
}

/** Larger of two raw quantities, exactly. */
export function maxRaw(a: RawLike | null | undefined, b: RawLike | null | undefined): bigint {
  const left = big(a);
  const right = big(b);
  return left >= right ? left : right;
}

/* -------------------------------------------------------------------- */
/* Raw → display                                                        */
/* -------------------------------------------------------------------- */

/**
 * Exact decimal string of a raw quantity divided by 10^decimals, trailing
 * zeros trimmed. Stays a string end to end: Intl.NumberFormat formats a
 * decimal string exactly but a number only to double precision (PEPECASH's
 * supply: 995,269,147.11111111 from the string, ...1111112 from the number).
 */
export function rawToDecimalString(
  value: RawLike | null | undefined,
  decimals = 8,
): string {
  const exact = big(value);
  if (decimals <= 0) return exact.toString();

  const negative = exact < 0n;
  const digits = (negative ? -exact : exact).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const sign = negative && (whole !== "0" || fraction !== "") ? "-" : "";
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/**
 * Digit grouping for an exact decimal string. Intl's V3 format() accepts a
 * string; the bundled lib types predate that, hence the signature cast.
 */
export function formatExact(
  decimal: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const format = new Intl.NumberFormat("en-US", options).format as (
    input: string | number,
  ) => string;
  return format(decimal);
}

/**
 * Raw quantity as a double, for paths where an approximation is correct:
 * chart geometry, progress fractions, USD estimates. Never for a value that
 * will be composed into a transaction.
 */
export function approx(value: RawLike | null | undefined): number {
  if (typeof value === "number") return value;
  return Number(big(value));
}

/**
 * Ratio of two raw quantities as a double. The operands may exceed double
 * range but the ratio is small by construction; scaling by {@link RATIO_SCALE}
 * keeps 12 significant figures through the bigint division.
 */
export function ratio(
  numerator: RawLike | null | undefined,
  denominator: RawLike | null | undefined,
): number {
  const bottom = big(denominator);
  if (bottom === 0n) return 0;
  return Number((big(numerator) * RATIO_SCALE) / bottom) / RATIO_SCALE_NUM;
}

/* -------------------------------------------------------------------- */
/* Display → raw                                                        */
/* -------------------------------------------------------------------- */

/**
 * Typed amount → exact raw units, or null when the text is not a number.
 * Reads the digits instead of `Math.round(parseFloat(s) * 1e8)`: a whole
 * XCP-69 bag is 10^16 raw, past double precision. Extra decimals truncate
 * (never round up a quantity someone is about to spend).
 */
export function parseUnitsToRaw(input: string, decimals = 8): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return null;
  const [, sign, whole, fraction = ""] = match;
  const scaled = `${whole || "0"}${fraction.slice(0, decimals).padEnd(decimals, "0")}`;
  const value = BigInt(scaled);
  return sign === "-" ? -value : value;
}

/**
 * Quantity reduced by a slippage percentage, floored. Produces min_*
 * parameters — the figure consensus checks fills against — so the result
 * must be exact and must not round upward. Converts through basis points
 * because tolerances carry one decimal (Auto computes tenths).
 */
export function reduceByPercent(
  value: RawLike | null | undefined,
  percent: number,
): bigint {
  const bps = BigInt(Math.round(Math.min(Math.max(percent, 0), 100) * 100));
  return (big(value) * (BPS_SCALE - bps)) / BPS_SCALE;
}

/** Percentage of a raw quantity, floored. Backs the 25/50/75/Max presets. */
export function percentOf(value: RawLike | null | undefined, percent: number): bigint {
  const bps = BigInt(Math.round(percent * 100));
  return (big(value) * bps) / BPS_SCALE;
}

/* -------------------------------------------------------------------- */
/* Compose serialization                                                */
/* -------------------------------------------------------------------- */

/**
 * Exact decimal digits for a compose query parameter. Last gate before a
 * value becomes a signed transaction: String() on an unsafe double prints
 * digits of an integer nobody chose, and past 1e21 prints exponent notation
 * the API cannot parse — so unsafe numbers throw instead. Strings and
 * bigints pass through; both carry exact digits.
 */
export function quantityParam(value: string | number | bigint): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to compose a non-finite quantity (${value}).`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Refusing to compose a fractional quantity (${value}).`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `Quantity ${value} is past the exact range of a JavaScript number. ` +
        `Pass it as a string or bigint.`,
    );
  }
  return value.toString();
}

/** Whether {@link quantityParam} would accept this value. */
export function isSafeQuantity(value: string | number | bigint): boolean {
  try {
    quantityParam(value);
    return true;
  } catch {
    return false;
  }
}
