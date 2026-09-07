import { describe, expect, it } from "vitest";
import { parseUnitsToRaw } from "../apps/web/src/lib/numeric";
import { normalizeMarks, sanitizeAmount } from "../apps/web/src/components/amount-input";
import { commas, fixed } from "../apps/web/src/lib/format";

/**
 * A number someone types must compose as the number they typed.
 *
 * Not a hundred times it and not a hundredth. Everything else on the page is
 * written in the reader's language — a French page groups with spaces and
 * marks the decimal with a comma — and the danger of doing that well is that
 * a display string can find its way into a field that a parser reads back.
 * Then the amount that gets signed is not the amount that was agreed to.
 *
 * Two rules keep those apart, and these are the tests for them.
 *
 *   1. What reaches a parser is plain: digits, at most one period, no
 *      grouping, no language. `parseUnitsToRaw` enforces it and returns null
 *      on anything else, so a localized string FAILS rather than being
 *      quietly reinterpreted.
 *   2. What a person types is normalized to that shape at the input, so
 *      typing a comma for a decimal is understood rather than dropped.
 */

describe("the parser refuses anything a language wrote", () => {
  it("takes the plain forms", () => {
    expect(parseUnitsToRaw("1.5")).toBe(150_000_000n);
    expect(parseUnitsToRaw("1234.56")).toBe(123_456_000_000n);
    expect(parseUnitsToRaw("0.00000001")).toBe(1n);
    expect(parseUnitsToRaw("21000000")).toBe(2_100_000_000_000_000n);
  });

  /**
   * The property that matters. A grouped or comma-decimal string is not a
   * number this accepts, so there is no reading of it to get wrong: it is
   * null, and every caller already treats null as "no amount yet".
   */
  it("returns null rather than a wrong number for every localized form", () => {
    const localized = [
      "1,5", // French, Portuguese, Russian: one and a half
      "1234,56",
      "1 234,56", // grouped with a space
      "1.234,56", // grouped with a period
      "1,234.56", // grouped with a comma
      "1 234,56", // the no-break space CLDR actually emits
      "1 234,56", // and the narrow one French uses
    ];
    for (const input of localized) expect(parseUnitsToRaw(input)).toBeNull();
  });

  it("in particular never turns a decimal comma into a hundredfold", () => {
    // The failure this file exists to prevent, stated as the assertion.
    expect(parseUnitsToRaw("1234,56")).not.toBe(parseUnitsToRaw("123456"));
    expect(parseUnitsToRaw("1234,56")).toBeNull();
  });
});

describe("the input normalizes to that shape before anything parses it", () => {
  it("reads a typed decimal comma as a decimal", () => {
    expect(sanitizeAmount("0,5")).toBe("0.5");
    expect(parseUnitsToRaw(sanitizeAmount("0,5")!)).toBe(50_000_000n);
  });

  it("reads a pasted grouped number in either convention", () => {
    expect(normalizeMarks("1,234.56")).toBe("1234.56");
    expect(normalizeMarks("1.234,56")).toBe("1234.56");
    expect(parseUnitsToRaw(normalizeMarks("1.234,56"))).toBe(123_456_000_000n);
  });

  it("hands the parser something it accepts, for every shape a person types", () => {
    for (const typed of ["0,5", "0.5", "1.234,56", "1,234.56", "100", "0.00000001"]) {
      const value = sanitizeAmount(typed);
      expect(value).not.toBeNull();
      expect(parseUnitsToRaw(value!)).not.toBeNull();
    }
  });
});

describe("display formatting never produces a composable amount", () => {
  /**
   * The guard against the two being confused later. A display formatter's
   * output is not something the parser accepts, in any locale that writes
   * numbers differently — so wiring one into a field cannot silently work.
   */
  it("is rejected by the parser wherever the language differs from English", () => {
    for (const locale of ["pt", "fr", "ru", "uk"]) {
      expect(parseUnitsToRaw(commas(1234.56, locale))).toBeNull();
      expect(parseUnitsToRaw(fixed(1234.56, 2, locale))).toBeNull();
    }
  });

  it("and English display grouping is refused too, rather than half-read", () => {
    expect(commas(1234.56, "en")).toBe("1,234.56");
    expect(parseUnitsToRaw(commas(1234.56, "en"))).toBeNull();
  });
});
