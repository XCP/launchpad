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
    expect(open[0]!.withheld).toBe("unreconciled");
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

  it("closes a position whose remainder cannot be sold for one satoshi", () => {
    // A constant-product sale divides in integers, so selling out leaves crumbs
    // rather than a clean zero. This wallet's real remainder was 4,986 raw
    // CAPTAINDAN against a 977 XCP / 22.08M token pool — 0.22 satoshi, which
    // floors to nothing. Before this it stayed "open" forever as a 0.00 holding
    // worth $0, with its realised profit printed twice beside it.
    const pool = [{ asset: "A", poolXcpReserve: 97_714_000_000n, poolTokenReserve: 2_208_012_300_000_000n }];
    const deltas: PairedDelta[] = [
      { asset: "A", block: 1, tokenDelta: 100_000_000_000_000n, xcpDelta: -1_000_000_000n },
      { asset: "A", block: 2, tokenDelta: -(100_000_000_000_000n - 4_986n), xcpDelta: 6_862_000_000n },
    ];
    const { open, closed } = computePositions(deltas, pool, new Map([["A", 4_986n]]));
    expect(open).toEqual([]);
    expect(closed).toEqual([{ asset: "A", realizedXcpSats: 5_862_000_001n }]);
  });

  it("keeps a position open while the remainder is still worth a satoshi", () => {
    const pool = [{ asset: "A", poolXcpReserve: 97_714_000_000n, poolTokenReserve: 2_208_012_300_000_000n }];
    const deltas: PairedDelta[] = [
      { asset: "A", block: 1, tokenDelta: 100_000_000_000_000n, xcpDelta: -1_000_000_000n },
      { asset: "A", block: 2, tokenDelta: -99_900_000_000_000n, xcpDelta: 6_862_000_000n },
    ];
    const { open, closed } = computePositions(deltas, pool, new Map([["A", 100_000_000_000n]]));
    expect(closed).toEqual([]);
    expect(open).toHaveLength(1);
    expect(open[0]!.valueXcpSats).toBeGreaterThan(0n);
  });

  it("never calls a holding dust when no pool can price it", () => {
    // With no reserves everything values at zero, so a real balance would be
    // indistinguishable from crumbs — the dust rule has to stand down.
    const pool = [{ asset: "A", poolXcpReserve: 0n, poolTokenReserve: 0n }];
    const deltas: PairedDelta[] = [{ asset: "A", block: 1, tokenDelta: 500n, xcpDelta: -100n }];
    const { open, closed } = computePositions(deltas, pool, new Map([["A", 500n]]));
    expect(closed).toEqual([]);
    expect(open).toHaveLength(1);
    expect(open[0]!.balance).toBe(500n);
  });
});
