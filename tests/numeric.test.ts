import { describe, expect, it } from "vitest";
import {
  big,
  isSafeQuantity,
  parseJsonLossless,
  parseUnitsToRaw,
  quantityParam,
  quoteUnsafeIntegers,
  ratio,
  rawEquals,
  rawToDecimalString,
  reduceByPercent,
  sumRaw,
  toBigInt,
} from "@launchpad/xcp69/numeric";

/**
 * The magnitudes this module exists for. XCP-69's hard cap is 10^16, which
 * sits above the double-exact line — every case here is a place where a
 * plain `Number` would agree with the wrong answer.
 */
const MAX_SAFE = 9_007_199_254_740_991; // 2^53 - 1
const HARD_CAP = "10000000000000000"; // 10^16, the standard's hard cap
const U64_MAX = "18446744073709551615";
const I64_MAX = "9223372036854775807"; // relaxed-mode hard caps reach this

describe("quoteUnsafeIntegers", () => {
  it("leaves safe integers alone", () => {
    expect(quoteUnsafeIntegers('{"a":1,"b":-42,"c":0}')).toBe('{"a":1,"b":-42,"c":0}');
    expect(quoteUnsafeIntegers(`{"a":${MAX_SAFE}}`)).toBe(`{"a":${MAX_SAFE}}`);
  });

  it("quotes integers past the double-exact line", () => {
    // 2^53 itself is representable but no longer identifies a single integer.
    expect(quoteUnsafeIntegers('{"a":9007199254740992}')).toBe('{"a":"9007199254740992"}');
    expect(quoteUnsafeIntegers(`{"cap":${HARD_CAP}}`)).toBe(`{"cap":"${HARD_CAP}"}`);
    expect(quoteUnsafeIntegers(`{"m":${U64_MAX}}`)).toBe(`{"m":"${U64_MAX}"}`);
  });

  it("never touches digits inside string literals", () => {
    const text = `{"note":"10000000000000000 is the cap","cap":${HARD_CAP}}`;
    expect(quoteUnsafeIntegers(text)).toBe(
      `{"note":"10000000000000000 is the cap","cap":"${HARD_CAP}"}`,
    );
  });

  it("is not fooled by an escaped quote inside a string", () => {
    // A naive scanner ends the string early here and then "sees" the digits.
    const text = `{"note":"say \\"99999999999999999\\" loudly","cap":${HARD_CAP}}`;
    expect(quoteUnsafeIntegers(text)).toBe(
      `{"note":"say \\"99999999999999999\\" loudly","cap":"${HARD_CAP}"}`,
    );
  });

  it("leaves fractions and exponents as numbers", () => {
    // Only integers are quoted — a price or a rate must stay a number.
    expect(quoteUnsafeIntegers('{"a":1.5,"b":1e21,"c":-2.5e-8}')).toBe(
      '{"a":1.5,"b":1e21,"c":-2.5e-8}',
    );
  });

  it("handles negatives past the line", () => {
    expect(quoteUnsafeIntegers('{"a":-10000000000000000}')).toBe('{"a":"-10000000000000000"}');
  });
});

describe("parseJsonLossless", () => {
  it("preserves the exact digits JSON.parse would destroy", () => {
    // 10^16 is even, so it survives a double round-trip on its own — the
    // hazard is its NEIGHBOUR. At this magnitude the gap between
    // representable doubles is 2, so an off-by-one record collapses onto the
    // cap itself and an `===` check would wave it through as conforming.
    const offByOne = "10000000000000001";
    expect(String(JSON.parse(`{"q":${offByOne}}`).q)).toBe(HARD_CAP);
    expect(parseJsonLossless<{ q: string }>(`{"q":${offByOne}}`).q).toBe(offByOne);
  });

  it("round-trips a u64 maximum without drift", () => {
    const parsed = parseJsonLossless<{ q: string }>(`{"q":${U64_MAX}}`);
    expect(big(parsed.q)).toBe(18446744073709551615n);
  });
});

describe("toBigInt / big", () => {
  it("accepts exact forms", () => {
    expect(toBigInt(5)).toBe(5n);
    expect(toBigInt("5")).toBe(5n);
    expect(toBigInt(7n)).toBe(7n);
    expect(toBigInt(HARD_CAP)).toBe(10_000_000_000_000_000n);
    expect(toBigInt(I64_MAX)).toBe(9223372036854775807n);
  });

  it("refuses anything it cannot represent exactly", () => {
    // A double past the safe line has already lost the original digits, so
    // trusting it would launder a wrong number into an exact-looking bigint.
    expect(toBigInt(9007199254740993)).toBeNull();
    expect(toBigInt(1.5)).toBeNull();
    expect(toBigInt(NaN)).toBeNull();
    expect(toBigInt("12.0")).toBeNull();
    expect(toBigInt("abc")).toBeNull();
    expect(toBigInt("")).toBeNull();
  });

  it("treats null and undefined as absent, which the API really returns", () => {
    // earned_quantity / paid_quantity are null before the first mint.
    expect(toBigInt(null)).toBeNull();
    expect(toBigInt(undefined)).toBeNull();
    expect(big(null)).toBe(0n);
    expect(big(undefined)).toBe(0n);
  });
});

describe("rawEquals", () => {
  it("rejects an off-by-one at 10^16, where === on doubles would not", () => {
    const cap = 10_000_000_000_000_000n;
    expect(rawEquals(HARD_CAP, cap)).toBe(true);
    expect(rawEquals("10000000000000001", cap)).toBe(false);
    // The whole reason the predicate compares digits: as doubles these are
    // the same value.
    expect(Number("10000000000000001") === Number(HARD_CAP)).toBe(true);
  });

  it("is false for unreadable values rather than defaulting to zero", () => {
    expect(rawEquals(null, 0n)).toBe(false);
    expect(rawEquals("x", 0n)).toBe(false);
  });
});

describe("sumRaw", () => {
  it("sums past the double range exactly", () => {
    expect(sumRaw([HARD_CAP, HARD_CAP, HARD_CAP])).toBe(30_000_000_000_000_000n);
  });

  it("skips nulls instead of poisoning the total", () => {
    expect(sumRaw([1, null, "2", undefined, 3n])).toBe(6n);
  });
});

describe("ratio", () => {
  it("keeps significant figures when both operands exceed the double range", () => {
    // 6.9e15 / 1e16 — the sale-progress computation on a real launch.
    expect(ratio("6900000000000000", HARD_CAP)).toBeCloseTo(0.69, 12);
  });

  it("returns 0 for a zero denominator rather than NaN or Infinity", () => {
    // A fairminter with no target must not render NaN — the bug the old
    // xcp.fun shipped.
    expect(ratio(HARD_CAP, 0)).toBe(0);
    expect(ratio(null, null)).toBe(0);
  });
});

describe("rawToDecimalString", () => {
  it("renders 10^16 raw as its exact whole-token value", () => {
    expect(rawToDecimalString(HARD_CAP)).toBe("100000000");
  });

  it("trims trailing zeros but keeps significant ones", () => {
    expect(rawToDecimalString(100_000_000)).toBe("1");
    expect(rawToDecimalString(150_000_000)).toBe("1.5");
    expect(rawToDecimalString(1)).toBe("0.00000001");
  });

  it("does not emit a negative zero", () => {
    expect(rawToDecimalString(0)).toBe("0");
    expect(rawToDecimalString(-0)).toBe("0");
  });
});

describe("parseUnitsToRaw", () => {
  it("reads digits rather than parseFloat, so 10^8 tokens stay exact", () => {
    expect(parseUnitsToRaw("100000000")).toBe(10_000_000_000_000_000n);
  });

  it("truncates extra decimals instead of rounding up", () => {
    // Rounding up would compose a quantity larger than the user typed.
    expect(parseUnitsToRaw("1.999999999")).toBe(199_999_999n);
  });

  it("rejects input that is not a number", () => {
    expect(parseUnitsToRaw("")).toBeNull();
    expect(parseUnitsToRaw(".")).toBeNull();
    expect(parseUnitsToRaw("1.2.3")).toBeNull();
    expect(parseUnitsToRaw("abc")).toBeNull();
  });
});

describe("reduceByPercent", () => {
  it("floors, so a min_* parameter is never above what consensus will fill", () => {
    expect(reduceByPercent(1000, 1)).toBe(990n);
    expect(reduceByPercent(999, 0.5)).toBe(994n); // 994.005 floored
  });

  it("clamps the tolerance to a sane range", () => {
    expect(reduceByPercent(1000, -5)).toBe(1000n);
    expect(reduceByPercent(1000, 500)).toBe(0n);
  });
});

describe("quantityParam", () => {
  it("passes exact forms through unchanged", () => {
    expect(quantityParam(10_000_000_000_000_000n)).toBe(HARD_CAP);
    expect(quantityParam(HARD_CAP)).toBe(HARD_CAP);
    expect(quantityParam(MAX_SAFE)).toBe(String(MAX_SAFE));
  });

  it("throws rather than composing digits it cannot vouch for", () => {
    // This is the last gate before a signature. Silently stringifying an
    // unsafe double here is how the wrong amount gets signed.
    expect(() => quantityParam(1e17)).toThrow(/past the exact range/);
    expect(() => quantityParam(1.5)).toThrow(/fractional/);
    expect(() => quantityParam(Infinity)).toThrow(/non-finite/);
    expect(() => quantityParam(NaN)).toThrow(/non-finite/);
  });

  it("never emits exponent notation", () => {
    // String(1e21) is "1e+21", which Counterparty would reject or misread.
    expect(quantityParam(10n ** 21n)).toBe("1000000000000000000000");
  });

  it("isSafeQuantity agrees with what quantityParam accepts", () => {
    expect(isSafeQuantity(1e17)).toBe(false);
    expect(isSafeQuantity(HARD_CAP)).toBe(true);
    expect(isSafeQuantity(10n ** 21n)).toBe(true);
  });
});
