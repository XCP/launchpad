/**
 * Exact integer handling for Counterparty quantities.
 *
 * A Counterparty quantity is an unsigned 64-bit integer. A JavaScript number is
 * a double, exact only to 2^53-1, and `JSON.parse` has no big-integer mode: an
 * integer literal above that is approximated to the nearest double *during
 * parsing*, before any application code runs. No care downstream can recover
 * the lost digits.
 *
 * This is not hypothetical on this site. The mainnet fairminter for
 * TTTTTAAAAAA reports `"hard_cap": 9223372036854775807`, which `JSON.parse`
 * turns into 9223372036854776000 — and that record is reachable at
 * /TTTTTAAAAAA while SHOW_NONCONFORMING is on. Worse, XCP-69's own hard cap of
 * 10^16 sits above the safe range (its ulp is 2), so a fairminter composed with
 * `hard_cap` one raw unit off the standard parses onto the standard's exact
 * value and passes `isXcp69`. The conformance predicate is this site's
 * editorial policy; parsing must not be allowed to blur it.
 *
 * The tool here is BigInt, not a decimal library: every value in question is an
 * integer, and BigInt is native, exact, and costs no bundle. Ratios and
 * percentages — small numbers by construction — stay doubles on purpose.
 */

/**
 * A raw integer quantity as it arrives from the API. Values inside the safe
 * range stay `number` so nothing that was already correct changes shape;
 * anything larger arrives as a `string` with every digit intact.
 *
 * The union is the point: it makes the compiler reject `total + row.quantity`,
 * which is the shape that silently narrows a 64-bit quantity to a double.
 */
export type Raw = number | string;

/**
 * A raw quantity in any of its exact forms — as it arrived, or as this module
 * hands it back. What display helpers accept, so a caller never has to narrow
 * an exact bigint back to something lossier just to render it.
 */
export type RawLike = Raw | bigint;

/** Raw units per whole unit of a divisible asset. */
export const SATS_PER_UNIT = 100_000_000n;

/* ------------------------------------------------------------------ */
/* Lossless JSON                                                       */
/* ------------------------------------------------------------------ */

/**
 * Rewrite unsafe integer literals as quoted strings.
 *
 * Walks the text rather than pattern-matching it: digits inside string literals
 * must not be touched, and a regex over the whole document would happily
 * rewrite a token description that contains a long number. In JSON, keys are
 * always strings, so any digit encountered outside a string literal begins a
 * numeric value.
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

      // A fraction or exponent means the value was never an exact integer, so
      // quoting it would change its meaning rather than preserve it.
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
 * `JSON.parse`, but integers too large for a double survive as strings instead
 * of being rounded. Throws exactly as `JSON.parse` does on malformed input, so
 * callers need no new error handling.
 */
export function parseJsonLossless<T = unknown>(text: string): T {
  return JSON.parse(quoteUnsafeIntegers(text)) as T;
}

/* ------------------------------------------------------------------ */
/* Exact integer arithmetic                                            */
/* ------------------------------------------------------------------ */

/**
 * A raw quantity as an exact bigint, or null when the value is not a whole
 * number this code can trust.
 *
 * Returns null rather than throwing because the API hands back `null` for
 * `earned_quantity` and friends on a fairminter with no mints, and a display
 * path must not explode on one. Callers that need a number pick their own
 * default — the old xcp.fun rendered NaN from exactly this.
 */
export function toBigInt(value: RawLike | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return null;
    // Past the safe range a double no longer identifies a single integer, so
    // converting one is a guess dressed as a fact. Only losslessJson-quoted
    // strings are trustworthy up here.
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/** A raw quantity as an exact bigint, substituting zero for anything unreadable. */
export function big(value: RawLike | null | undefined): bigint {
  return toBigInt(value) ?? 0n;
}

/**
 * Exact equality between a raw quantity and a known constant.
 *
 * The reason `isXcp69` cannot use `===`: the standard's hard cap is 10^16,
 * above the safe range, so a record one unit off parses onto it. Comparing the
 * preserved digits instead keeps the predicate the exact-equality test the
 * standard says it is.
 */
export function rawEquals(value: RawLike | null | undefined, expected: bigint): boolean {
  const exact = toBigInt(value);
  return exact !== null && exact === expected;
}

/** Exact sum. The counterpart to `+`, which is where accumulators lose digits. */
export function sumRaw(values: Iterable<RawLike | null | undefined>): bigint {
  let total = 0n;
  for (const value of values) total += big(value);
  return total;
}

/** The larger of two raw quantities, exactly. */
export function maxRaw(a: RawLike | null | undefined, b: RawLike | null | undefined): bigint {
  const left = big(a);
  const right = big(b);
  return left >= right ? left : right;
}

/* ------------------------------------------------------------------ */
/* Raw → display                                                       */
/* ------------------------------------------------------------------ */

/**
 * A raw quantity as an exact decimal string, divided by 10^`decimals`.
 *
 * The string is the point. `Intl.NumberFormat` formats a decimal string
 * exactly and a number only as precisely as a double allows, so a display path
 * must never convert on the way to the formatter. PEPECASH's supply renders as
 * 995,269,147.11111111 from the string and 995,269,147.1111112 from the number.
 *
 * Trailing zeros are trimmed: 4 renders as "4", not "4.00000000".
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
 * Group a decimal string for display, keeping every digit it was given.
 *
 * Intl's V3 signature accepts a string; the bundled lib types still describe
 * only the older one, so the correction belongs on the signature rather than on
 * the value — the value really is a string, and casting it would say otherwise.
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
 * A raw quantity as a double, for arithmetic where an approximation is the
 * honest answer: chart geometry, progress bars, percentages, USD estimates.
 *
 * Named for what it does. Reach for it deliberately, never as a way to quiet a
 * type error on a value that is about to be composed into a transaction.
 */
export function approx(value: RawLike | null | undefined): number {
  if (typeof value === "number") return value;
  return Number(big(value));
}

/**
 * The ratio of two raw quantities as a double.
 *
 * A ratio is small by construction — a progress fraction, a price, a multiple —
 * so a double holds it fine. What a double could not hold is the operands, and
 * dividing them as bigints first would floor the answer to zero. Scaling by
 * 10^12 keeps twelve significant figures, far beyond what any of this renders.
 */
export function ratio(
  numerator: RawLike | null | undefined,
  denominator: RawLike | null | undefined,
): number {
  const bottom = big(denominator);
  if (bottom === 0n) return 0;
  const SCALE = 1_000_000_000_000n;
  return Number((big(numerator) * SCALE) / bottom) / 1e12;
}

/* ------------------------------------------------------------------ */
/* Compose serialization                                               */
/* ------------------------------------------------------------------ */

/**
 * A quantity's exact decimal digits, for a compose query parameter — or a
 * throw, when the value cannot be trusted to have any.
 *
 * This is the last gate before a number becomes a signed transaction. `String`
 * on a double is wrong twice over up here: past 2^53 the digits it prints are
 * an approximation of an integer nobody chose, and past 1e21 it prints
 * exponent notation ("1e+21") that the API cannot read as a quantity at all.
 * Either way the user signs an order for an amount they never asked for, so
 * failing loudly is the only safe behaviour.
 *
 * Strings and bigints pass through: both carry their digits exactly, which is
 * how a caller expresses a quantity larger than a double can hold.
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
      `Quantity ${value} is past the exact range of a JavaScript number, so its ` +
        `digits are no longer the ones intended. Pass it as a string or bigint.`,
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
