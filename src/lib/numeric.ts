/**
 * Exact integer handling for Counterparty quantities (unsigned 64-bit).
 * Doubles are exact only to 2^53-1 and JSON.parse rounds larger literals
 * during parsing; XCP-69's 10^16 hard cap sits above that line, so equality
 * checks and compose parameters must see exact digits. BigInt throughout;
 * ratios and percentages are small by construction and stay doubles.
 */

/**
 * A raw quantity as parsed: `number` within the safe range, `string` above
 * it. The union makes the compiler reject bare arithmetic on quantities.
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
 * Quote integer literals outside the double-safe range. Walks the text so
 * digits inside string literals are untouched; fractions/exponents pass.
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

/** JSON.parse with integers above 2^53-1 preserved as strings. */
export function parseJsonLossless<T = unknown>(text: string): T {
  return JSON.parse(quoteUnsafeIntegers(text)) as T;
}

/* -------------------------------------------------------------------- */
/* Exact integer arithmetic                                             */
/* -------------------------------------------------------------------- */

/**
 * Exact bigint, or null for non-integers, unsafe doubles, and null/undefined
 * (the API returns null quantities on fairminters with no mints).
 */
export function toBigInt(value: RawLike | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
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
 * Exact equality against a known constant; `===` on parsed doubles would
 * accept off-by-one records at 10^16 magnitudes.
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

/** Sort comparator, largest first; `b - a` can return 0 for u64s that differ. */
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
 * Exact decimal string of a raw quantity / 10^decimals, trailing zeros
 * trimmed. String end to end: Intl formats strings exactly, numbers only to
 * double precision.
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
 * Digit grouping for an exact decimal string. Intl's format() accepts a
 * string; the bundled lib types predate that, hence the cast.
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
 * Raw quantity as a double — only for approximate paths (charts, progress,
 * USD), never for a value that will be composed.
 */
export function approx(value: RawLike | null | undefined): number {
  if (typeof value === "number") return value;
  return Number(big(value));
}

/**
 * Ratio of two raw quantities as a double; scaled through bigint division so
 * oversized operands keep 12 significant figures.
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
 * Typed amount → exact raw units, or null if not a number. Reads digits
 * rather than parseFloat (10^16 raw exceeds double precision); extra
 * decimals truncate, never round up.
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
 * Quantity reduced by a slippage percentage, floored — produces the min_*
 * parameters consensus checks fills against. Basis points, since tolerances
 * carry one decimal.
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
 * Exact decimal digits for a compose query parameter — the last gate before
 * signing. Unsafe doubles throw (String() would print wrong digits or
 * exponent notation); strings and bigints pass through.
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
