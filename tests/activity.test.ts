import { describe, expect, it } from "vitest";
import { computeActivity, reconcileActivity } from "@/lib/activity";

describe("profile activity", () => {
  it("keeps same-sized trades in one block distinct by event", () => {
    const rows = computeActivity(
      [
        { event: "tx-a", asset: "A", block: 10, tokenDelta: "5", xcpDelta: "-1", kind: "buy" },
        { event: "tx-b", asset: "A", block: 10, tokenDelta: "5", xcpDelta: "-1", kind: "buy" },
      ],
      [],
      new Map([["A", true]]),
    );
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("shows one honest residual instead of inventing a transfer type or date", () => {
    const rows = computeActivity(
      [{ event: "tx", asset: "A", block: 10, tokenDelta: "5", xcpDelta: "-1", kind: "buy" }],
      [],
      new Map([["A", true]]),
    );
    const result = reconcileActivity(rows, new Map([["A", "8"]]));
    expect(result.at(-1)).toMatchObject({
      kind: "movement_in",
      block: null,
      tokenDelta: 3n,
      xcpDelta: 0n,
    });
  });
});
