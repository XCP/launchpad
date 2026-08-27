import { describe, expect, it } from "vitest";
import {
  historicalUsdAt,
  priceChangePercent,
  usdPriceChangePercent,
} from "@/lib/market";

describe("market price change", () => {
  it("measures CAPTAINDAN-style performance from mint price", () => {
    expect(priceChangePercent(0.00003886, 0.00001)).toBeCloseTo(288.6, 10);
  });

  it("does not manufacture a percentage without two positive prices", () => {
    expect(priceChangePercent(0, 0.00001)).toBeNull();
    expect(priceChangePercent(0.00001, 0)).toBeNull();
  });

  it("includes XCP's USD move from the launch-time baseline", () => {
    // Token is 4x higher in XCP and XCP itself doubled in dollars: 8x total.
    expect(usdPriceChangePercent(0.00004, 4, 0.00001, 2)).toBeCloseTo(700, 10);
  });

  it("does not silently fall back to an XCP-only return", () => {
    expect(usdPriceChangePercent(0.00004, 4, 0.00001, null)).toBeNull();
    expect(usdPriceChangePercent(0.00004, null, 0.00001, 2)).toBeNull();
  });
});

describe("historical USD lookup", () => {
  const history = [
    { day: "2026-08-01", usd: 2 },
    { day: "2026-08-03", usd: 3 },
  ];

  it("carries the previous mark across a missing day", () => {
    expect(
      historicalUsdAt(history, Date.parse("2026-08-02T12:00:00Z") / 1000),
    ).toBe(2);
  });

  it("does not value old activity with a future mark", () => {
    expect(
      historicalUsdAt(history, Date.parse("2026-07-31T12:00:00Z") / 1000),
    ).toBeNull();
  });
});
