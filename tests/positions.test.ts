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

  it("marks an incoming transfer at arrival value without losing known trade basis", () => {
    const deltas: PairedDelta[] = [
      { asset: "A", block: 1, tokenDelta: 100n, xcpDelta: -100n },
      {
        asset: "A",
        block: 2,
        tokenDelta: 10n,
        xcpDelta: 0n,
        external: true,
      },
    ];
    const { open } = computePositions(
      deltas,
      universe,
      new Map([["A", 110n]]),
      (_asset, _block, quantity) => quantity * 2n,
    );
    expect(open[0]).toMatchObject({
      costXcpSats: 120n,
      valueXcpSats: 220n,
      unrealizedXcpSats: 100n,
      realizedXcpSats: 0n,
    });
    expect(open[0]!.withheld).toBeUndefined();
  });

  it("carries basis out on an external transfer without realizing a loss", () => {
    const deltas: PairedDelta[] = [
      { asset: "A", block: 1, tokenDelta: 100n, xcpDelta: -100n },
      {
        asset: "A",
        block: 2,
        tokenDelta: -25n,
        xcpDelta: 0n,
        external: true,
      },
    ];
    const { open } = computePositions(deltas, universe, new Map([["A", 75n]]));
    expect(open[0]).toMatchObject({
      costXcpSats: 75n,
      realizedXcpSats: 0n,
      unrealizedXcpSats: 75n,
    });
  });
});
