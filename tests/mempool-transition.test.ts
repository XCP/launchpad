import { describe, expect, it } from "vitest";
import { disappearedMints } from "#api/scheduler/mempool-transition";

describe("mempool transition", () => {
  it("does not treat the initial snapshot or arrivals as confirmations", () => {
    expect(disappearedMints([], ["a", "b"])).toBe(0);
    expect(disappearedMints(["a"], ["a", "b"])).toBe(0);
  });

  it("counts transactions that left while others remain", () => {
    expect(disappearedMints(["a", "b", "c"], ["b", "d"])).toBe(2);
  });

  it("deduplicates malformed repeated identifiers", () => {
    expect(disappearedMints(["a", "a", "b"], ["b", "b"])).toBe(1);
  });
});
