import { describe, expect, it } from "vitest";
import {
  bindNumbers,
  commas,
  compact,
  fiat,
  fixed,
  intlLocale,
  percent,
  price,
} from "../apps/web/src/lib/format";
import { normalizeMarks, sanitizeAmount } from "../apps/web/src/components/amount-input";
import { LOCALES } from "../apps/web/src/lib/i18n/locales";

/**
 * A number is not language-neutral. These lock the two things that broke in
 * production before the formatters took a locale: a French page grouping in
 * English commas, and a Brazilian typing "0,5" into an amount field and
 * getting zero.
 */

describe("grouping and decimal marks follow the page", () => {
  it("groups the four locales that do not group in commas", () => {
    expect(commas(1234567.89, "en")).toBe("1,234,567.89");
    expect(commas(1234567.89, "ja")).toBe("1,234,567.89");
    expect(commas(1234567.89, "pt")).toBe("1.234.567,89");
    // French, Russian and Ukrainian all group with a space; which space
    // character CLDR picks is its business, not ours.
    for (const locale of ["fr", "ru", "uk"]) {
      expect(commas(1234567.89, locale)).toMatch(/^1.234.567,89$/);
    }
  });

  it("keeps K/M/B Latin while the decimal mark moves", () => {
    expect(compact(1234567, "en")).toBe("1.23M");
    expect(compact(1234567, "pt")).toBe("1,23M");
    expect(compact(1234567, "fr")).toBe("1,23M");
  });

  it("carries the locale into a sub-unit price", () => {
    expect(price(0.00012345, "en")).toBe("0.0001235");
    expect(price(0.00012345, "fr")).toBe("0,0001235");
  });

  it("compacts fiat in the page's own conventions, not English", () => {
    expect(fiat(638_260, "BRL", "pt")).toContain("638,26K");
    expect(fiat(267_390, "EUR", "fr")).toContain("267,39K");
  });

  it("gives every shipped locale a real Intl tag", () => {
    for (const locale of LOCALES) {
      expect(() => new Intl.NumberFormat(intlLocale(locale))).not.toThrow();
    }
  });
});

describe("fixed", () => {
  it("pads and truncates to exactly the places asked for", () => {
    expect(fixed(1.5, 2, "en")).toBe("1.50");
    expect(fixed(1.567, 2, "en")).toBe("1.57");
    expect(fixed(42, 0, "en")).toBe("42");
    expect(fixed(0.000012345, 8, "en")).toBe("0.00001235");
  });

  it("groups and marks the decimal the way the page does", () => {
    expect(fixed(1234.5, 2, "en")).toBe("1,234.50");
    expect(fixed(1234.5, 2, "pt")).toBe("1.234,50");
    expect(fixed(1234.5, 2, "fr")).toMatch(/^1.234,50$/);
  });

  it("is the shape a column wants, where commas is the shape a quantity wants", () => {
    // The distinction the escape hatch was being used to express: a column
    // of 1.50 and 1.20 reads as one measure, 1.5 beside 1.2 as two.
    expect(commas(1.5, "en")).toBe("1.5");
    expect(fixed(1.5, 2, "en")).toBe("1.50");
  });

  it("does not print NaN at a reader", () => {
    expect(fixed(Number.NaN, 2, "en")).toBe("—");
    expect(fixed(Number.POSITIVE_INFINITY, 2, "en")).toBe("—");
  });
});

describe("percent", () => {
  it("takes a ratio and writes the sign where the language puts it", () => {
    expect(percent(0.123, {}, "en")).toBe("12.3%");
    expect(percent(0.123, {}, "pt")).toBe("12,3%");
    // French and Russian separate the sign from the digits; Ukrainian does
    // not. Intl knows that, which is why we do not hand-write the "%".
    expect(percent(0.123, {}, "fr")).toMatch(/^12,3.%$/);
    expect(percent(0.123, {}, "uk")).toBe("12,3%");
  });

  it("shows a plus on a gain only when asked", () => {
    expect(percent(0.125, { signed: true }, "en")).toBe("+12.5%");
    expect(percent(-0.03, { signed: true, digits: 1 }, "en")).toBe("-3%");
    expect(percent(0, { signed: true }, "en")).toBe("0%");
    expect(percent(0.125, {}, "en")).toBe("12.5%");
  });

  it("rounds to the digits asked for and drops a trailing zero", () => {
    expect(percent(0.5, { digits: 1 }, "en")).toBe("50%");
    expect(percent(0.12345, { digits: 2 }, "en")).toBe("12.35%");
    expect(percent(Number.NaN, {}, "en")).toBe("—");
  });
});

describe("bindNumbers", () => {
  it("binds every formatter to one locale", () => {
    const num = bindNumbers("fr");
    expect(num.intl).toBe("fr-FR");
    expect(num.compact(1234567)).toBe("1,23M");
    expect(num.percent(0.5, { digits: 0 })).toMatch(/^50.%$/);
    expect(num.satsPerVb(1.56)).toBe("1,56");
  });

  it("leaves English alone", () => {
    const num = bindNumbers("en");
    expect(num.commas(1234.5)).toBe("1,234.5");
    expect(num.compact(1234567)).toBe("1.23M");
    expect(num.percent(0.123)).toBe("12.3%");
  });
});

describe("amount fields accept either decimal mark", () => {
  it("normalizes a typed comma so a Brazilian does not send zero", () => {
    expect(sanitizeAmount("0,5")).toBe("0.5");
    expect(sanitizeAmount("0,")).toBe("0.");
    expect(sanitizeAmount("12,345678")).toBe("12.345678");
  });

  it("reads a pasted grouped number in either convention", () => {
    expect(normalizeMarks("1,234.56")).toBe("1234.56");
    expect(normalizeMarks("1.234,56")).toBe("1234.56");
    expect(normalizeMarks("1 234,56".replace(/ /g, ""))).toBe("1234.56");
    expect(sanitizeAmount("1.234.567")).toBe("1234567");
    expect(sanitizeAmount("1,234,567")).toBe("1234567");
  });

  it("still lets a period amount through untouched", () => {
    expect(sanitizeAmount("")).toBe("");
    expect(sanitizeAmount("5.")).toBe("5.");
    expect(sanitizeAmount(".5")).toBe(".5");
    expect(sanitizeAmount("100")).toBe("100");
  });

  it("treats a mistyped second mark as a slip, not as grouping", () => {
    expect(sanitizeAmount("1.2.3")).toBe("1.23");
  });

  it("rejects what is not a number at all", () => {
    expect(sanitizeAmount("abc")).toBe(null);
    expect(sanitizeAmount("1e5")).toBe("15");
  });
});
