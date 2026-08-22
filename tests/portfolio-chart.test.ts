import { describe, expect, it } from "vitest";
import { anchorBalanceWindow, buildPortfolioSeries } from "@/lib/portfolio-chart";

describe("portfolio value-history reconciliation", () => {
  it("derives the exact opening balance from live balance and later movements", () => {
    const deltas = anchorBalanceWindow(
      [
        { asset: "TOKEN", block: 105, tokenDelta: 100n },
        { asset: "TOKEN", block: 110, tokenDelta: -25n },
      ],
      new Map([["TOKEN", "150"]]),
      100,
    );

    expect(deltas).toEqual([
      { asset: "TOKEN", block: 100, tokenDelta: 75n },
      { asset: "TOKEN", block: 105, tokenDelta: 100n },
      { asset: "TOKEN", block: 110, tokenDelta: -25n },
    ]);
  });

  it("keeps an asset that was fully moved out during the window", () => {
    const deltas = anchorBalanceWindow(
      [{ asset: "TOKEN", block: 110, tokenDelta: -100n }],
      new Map([["TOKEN", "0"]]),
      100,
    );

    expect(deltas).toEqual([
      { asset: "TOKEN", block: 100, tokenDelta: 100n },
      { asset: "TOKEN", block: 110, tokenDelta: -100n },
    ]);
  });

  it("produces a series whose final balance agrees with the live balance", () => {
    const deltas = anchorBalanceWindow(
      [
        { asset: "TOKEN", block: 105, tokenDelta: 100n },
        { asset: "TOKEN", block: 110, tokenDelta: -25n },
      ],
      new Map([["TOKEN", "150"]]),
      100,
    );
    const series = buildPortfolioSeries({
      deltas,
      prices: new Map([
        [
          "TOKEN",
          [{ block: 100, time: 1, xcpReserve: 1n, tokenReserve: 1n }],
        ],
      ]),
      fromBlock: 100,
      toBlock: 110,
      points: 3,
    });

    expect(series.map((point) => point.xcpSats)).toEqual([75n, 175n, 150n]);
  });
});
