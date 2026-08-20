import { describe, expect, it } from "vitest";
import {
  defaultTradeAsset,
  orderTradeAssets,
} from "@/lib/trade-selection";

describe("trade asset selection", () => {
  it("defaults standalone swap and limit forms to MINTS when available", () => {
    expect(defaultTradeAsset(["CAPTAINDAN", "MINTS", "PEPECASH"])).toBe("MINTS");
  });

  it("falls back to the deepest available market when MINTS is unavailable", () => {
    expect(defaultTradeAsset(["CAPTAINDAN", "PEPECASH"])).toBe("CAPTAINDAN");
    expect(defaultTradeAsset([])).toBe("");
  });

  it("puts MINTS first without disturbing the relative order of other markets", () => {
    expect(orderTradeAssets(["CAPTAINDAN", "PEPECASH", "MINTS", "GOOBY"])).toEqual([
      "MINTS",
      "CAPTAINDAN",
      "PEPECASH",
      "GOOBY",
    ]);
  });
});
