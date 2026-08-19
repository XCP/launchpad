import { describe, expect, it } from "vitest";
import { computePositions, totalPnlXcpSats, type PairedDelta } from "@/lib/positions";

const universe = [{ asset: "A", poolXcpReserve: 2_000n, poolTokenReserve: 1_000n }];
const boughtThenPartSold: PairedDelta[] = [
  { asset: "A", block: 1, tokenDelta: 100n, xcpDelta: -100n },
  { asset: "A", block: 2, tokenDelta: -40n, xcpDelta: 80n },
];

describe("position accounting", () => {
  it("keeps realized profit from a partial sale in total PnL", () => {
    const { open } = computePositions(boughtThenPartSold, universe, new Map([["A", 60n]]));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      costXcpSats: 60n,
      valueXcpSats: 120n,
      unrealizedXcpSats: 60n,
      realizedXcpSats: 40n,
    });
    expect(totalPnlXcpSats(open[0]!)).toBe(100n);
  });

  it("moves a fully exited position into closed history", () => {
    const deltas = [
      ...boughtThenPartSold,
      { asset: "A", block: 3, tokenDelta: -60n, xcpDelta: 120n },
    ];
    const result = computePositions(deltas, universe, new Map([["A", 0n]]));
    expect(result.open).toHaveLength(0);
    expect(result.closed).toEqual([{ asset: "A", realizedXcpSats: 100n }]);
  });

  it("withholds PnL when focused history does not match the live balance", () => {
    const { open } = computePositions(boughtThenPartSold, universe, new Map([["A", 61n]]));
    expect(open[0]!.valueXcpSats).toBe(122n);
    expect(open[0]!.unrealizedXcpSats).toBeNull();
    expect(totalPnlXcpSats(open[0]!)).toBeNull();
    expect(open[0]!.withheld).toContain("doesn't reconcile");
  });
});
