import { describe, expect, it } from "vitest";
import { xcpOrderRemaining, orderAssetDecimals } from "../apps/web/src/lib/order-legs";

describe("each remaining quantity retains its own asset units", () => {
  it.each([false, true])("prices both order directions with token divisible=%s", divisible => {
    const token = divisible ? "10000000000" : "100";
    for (const [give_asset, give_remaining, get_asset, get_remaining] of [
      ["TOKEN", token, "XCP", "250000000"], ["XCP", "250000000", "TOKEN", token],
    ]) {
      const result = xcpOrderRemaining({ give_asset, give_remaining, get_asset, get_remaining }, "TOKEN", divisible)!;
      expect(result.tokenRaw.toString()).toBe(token);
      expect(result.xcpRaw).toBe(250000000n);
      expect(result.price).toBe(0.025);
    }
  });
  it("does not relabel another token as XCP or accept malformed raw quantities", () => {
    expect(xcpOrderRemaining({ give_asset: "TOKEN", get_asset: "OTHER", give_remaining: "100", get_remaining: "250" }, "TOKEN", false)).toBeNull();
    expect(xcpOrderRemaining({ give_asset: "TOKEN", get_asset: "XCP", give_remaining: Number.MAX_SAFE_INTEGER + 1, get_remaining: "250" }, "TOKEN", false)).toBeNull();
  });
  it("leaves unknown token divisibility unknown rather than assuming XCP's scale", () => {
    expect(orderAssetDecimals("TOKEN")).toBeNull();
    expect(orderAssetDecimals("TOKEN", { divisible: false })).toBe(0);
    expect(orderAssetDecimals("TOKEN", { divisible: true })).toBe(8);
    expect(orderAssetDecimals("XCP")).toBe(8);
  });
});
