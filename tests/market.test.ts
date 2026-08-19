import { describe, expect, it } from "vitest";
import { priceChangePercent } from "@/lib/market";

describe("market price change", () => {
  it("measures CAPTAINDAN-style performance from mint price", () => {
    expect(priceChangePercent(0.00003886, 0.00001)).toBeCloseTo(288.6, 10);
  });

  it("does not manufacture a percentage without two positive prices", () => {
    expect(priceChangePercent(0, 0.00001)).toBeNull();
    expect(priceChangePercent(0.00001, 0)).toBeNull();
  });
});
