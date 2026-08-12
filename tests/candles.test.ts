import { describe, expect, it } from "vitest";
import {
  bucketIds,
  fillPrice,
  foldCandles,
  PRICE_SCALE,
  RESOLUTIONS,
  type Candle,
  type Fill,
  type Stored,
} from "@launchpad/xcp69/candles";

const ASSET = "TESTCOIN";
const DAY = 86_400;
const HOUR = 3_600;

/** A day boundary, so bucket arithmetic is readable in the assertions. */
const T0 = 1_700_000_000 - (1_700_000_000 % DAY);

const fill = (over: Partial<Fill> = {}): Fill => ({
  time: T0 + HOUR,
  block: 900_000,
  xcp: 1_000_000n, // 0.01 XCP
  token: 100_000_000_000n, // 1,000 tokens
  ...over,
});

const daily = (candles: Candle[]) => candles.filter((c) => c.resolution === "1d");
const one = (candles: Candle[], res = "1d") => {
  const hit = candles.filter((c) => c.resolution === res);
  expect(hit).toHaveLength(1);
  return hit[0]!;
};

describe("fillPrice", () => {
  it("prices a fill from its own two legs", () => {
    // 0.01 XCP for 1,000 tokens = 0.00001 XCP per token, scaled by 1e8.
    expect(fillPrice(1_000_000n, 100_000_000_000n)).toBe(1_000n);
  });

  it("rounds half up rather than truncating", () => {
    // Flooring biases every price down, always in the same direction — the
    // reason this isn't a plain BigInt divide. 1/3 scaled = 33333333.33…
    expect(fillPrice(1n, 3n)).toBe(33_333_333n);
    // Exactly .5 goes up, not down.
    expect(fillPrice(1n, 2n * PRICE_SCALE)).toBe(1n);
  });

  it("drops a degenerate fill instead of folding it as zero", () => {
    // A zero price would drag a candle's low to 0 and print a chart that
    // claims the token traded at nothing.
    expect(fillPrice(0n, 100n)).toBeNull();
    expect(fillPrice(100n, 0n)).toBeNull();
    expect(fillPrice(-5n, 100n)).toBeNull();
  });
});

describe("bucketIds", () => {
  it("floors to each resolution's boundary", () => {
    const ids = bucketIds(ASSET, T0 + HOUR + 61);
    expect(ids).toHaveLength(RESOLUTIONS.length);
    expect(ids.find((b) => b.res === "1d")!.start).toBe(T0);
    expect(ids.find((b) => b.res === "1h")!.start).toBe(T0 + HOUR);
  });

  it("keys by asset, so two tokens never share a bucket", () => {
    expect(bucketIds("AAA", T0)[0]!.id).not.toBe(bucketIds("BBB", T0)[0]!.id);
  });
});

describe("foldCandles — OHLC within one bucket", () => {
  const fills: Fill[] = [
    fill({ time: T0 + 1, block: 1, xcp: 1_000_000n }), // price 1000 — open
    fill({ time: T0 + 2, block: 2, xcp: 3_000_000n }), // price 3000 — high
    fill({ time: T0 + 3, block: 3, xcp: 500_000n }), //   price  500 — low
    fill({ time: T0 + 4, block: 4, xcp: 2_000_000n }), // price 2000 — close
  ];

  it("takes open from the first fill and close from the last", () => {
    const c = one(foldCandles(ASSET, fills));
    expect(c.open).toBe(1_000n);
    expect(c.close).toBe(2_000n);
  });

  it("takes high and low from the extremes, not the endpoints", () => {
    const c = one(foldCandles(ASSET, fills));
    expect(c.high).toBe(3_000n);
    expect(c.low).toBe(500n);
  });

  it("conserves volume and counts every trade", () => {
    const c = one(foldCandles(ASSET, fills));
    expect(c.volume).toBe(6_500_000n);
    expect(c.volume).toBe(fills.reduce((sum, f) => sum + f.xcp, 0n));
    expect(c.trades).toBe(4);
  });

  it("orders by time regardless of the order fills arrive in", () => {
    // The API does not promise chronological order; open/close would be
    // whichever row happened to come first.
    const shuffled = [fills[2]!, fills[0]!, fills[3]!, fills[1]!];
    const c = one(foldCandles(ASSET, shuffled));
    expect(c.open).toBe(1_000n);
    expect(c.close).toBe(2_000n);
  });

  it("folds the same fill into every resolution at once", () => {
    const all = foldCandles(ASSET, fills);
    expect(all.filter((c) => c.resolution === "1h")).toHaveLength(1);
    expect(all.filter((c) => c.resolution === "1d")).toHaveLength(1);
    // Same trades, same volume, different span.
    for (const c of all) expect(c.volume).toBe(6_500_000n);
  });
});

describe("foldCandles — bucket boundaries", () => {
  it("splits fills either side of a day boundary", () => {
    const candles = daily(
      foldCandles(ASSET, [
        fill({ time: T0 + DAY - 1, block: 1 }),
        fill({ time: T0 + DAY, block: 2 }),
      ]),
    );
    expect(candles).toHaveLength(2);
    expect(candles.map((c) => c.bucketStart).sort()).toEqual([T0, T0 + DAY]);
  });

  it("ignores a fill with no usable timestamp", () => {
    // block_time can be absent; bucketing it at the epoch would draw a
    // candle in 1970.
    expect(foldCandles(ASSET, [fill({ time: 0 })])).toHaveLength(0);
    expect(foldCandles(ASSET, [fill({ time: -1 })])).toHaveLength(0);
  });

  it("returns nothing for no fills rather than an empty candle", () => {
    expect(foldCandles(ASSET, [])).toEqual([]);
  });
});

describe("foldCandles — merging onto a stored bucket", () => {
  // The case that matters for the indexer: a tick sees only the fills past
  // its cursor, so a bucket spanning two ticks must accumulate.
  const priorDaily: Candle = {
    id: `${ASSET}:1d:${T0}`,
    asset: ASSET,
    resolution: "1d",
    bucketStart: T0,
    open: 1_000n,
    high: 3_000n,
    low: 500n,
    close: 2_000n,
    volume: 6_500_000n,
    trades: 4,
    lastBlock: 4,
  };
  const stored: Stored = new Map([[priorDaily.id, priorDaily]]);

  it("accumulates onto the stored row instead of replacing it", () => {
    // Without the merge, a day's high/low/volume would be overwritten by
    // whatever single trade arrived this tick.
    const c = one(foldCandles(ASSET, [fill({ time: T0 + 5, block: 5, xcp: 4_000_000n })], stored));
    expect(c.open).toBe(1_000n); // never revised
    expect(c.close).toBe(4_000n);
    expect(c.high).toBe(4_000n);
    expect(c.low).toBe(500n); // survives from the stored row
    expect(c.volume).toBe(10_500_000n);
    expect(c.trades).toBe(5);
    expect(c.lastBlock).toBe(5);
  });

  it("drops fills at or below lastBlock, making a re-read free", () => {
    // Re-reading the boundary block is deliberate; double-counting it is not.
    const c = foldCandles(ASSET, [fill({ time: T0 + 5, block: 4 })], stored).find(
      (x) => x.resolution === "1d",
    );
    expect(c).toBeUndefined();
  });

  it("does not double-count when a re-read and a new fill arrive together", () => {
    const candles = foldCandles(
      ASSET,
      [
        fill({ time: T0 + 5, block: 4, xcp: 9_000_000n }), // already folded
        fill({ time: T0 + 6, block: 5, xcp: 1_000_000n }), // genuinely new
      ],
      stored,
    );
    const c = one(candles);
    expect(c.volume).toBe(7_500_000n); // 6.5M + 1M, not + 9M
    expect(c.trades).toBe(5);
  });

  it("leaves an untouched bucket out of the result entirely", () => {
    // Writing back an unchanged row would bill a D1 write for nothing.
    expect(foldCandles(ASSET, [], stored)).toEqual([]);
  });
});
