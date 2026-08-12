/**
 * OHLCV folding, shared by the indexer that writes `price_candles` and the
 * web app that has to fold live fills itself when the table has nothing yet.
 *
 * It lives here for the same reason the conformance predicate does: two
 * implementations of the same fold would eventually disagree, and the first
 * anyone would notice is a chart that stops matching the trades it plots.
 */

/** Scale for storing a sub-1 price as an exact integer: XCP sats per token. */
export const PRICE_SCALE = 100_000_000n;

export interface Resolution {
  id: string;
  seconds: number;
}

export const RESOLUTIONS: Resolution[] = [
  { id: "1h", seconds: 3_600 },
  { id: "1d", seconds: 86_400 },
];

export interface Fill {
  /** Real Unix seconds — the bucket this folds into. */
  time: number;
  block: number;
  xcp: bigint;
  token: bigint;
}

export interface Candle {
  id: string;
  asset: string;
  resolution: string;
  bucketStart: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
  trades: number;
  /** Highest block folded in — see foldCandles on why merging needs it. */
  lastBlock: number;
}

/** What a bucket already holds, keyed by candle id. */
export type Stored = Map<string, Candle>;

/** Which bucket a fill belongs to, at every resolution we keep. */
export function bucketIds(
  asset: string,
  time: number,
): { id: string; res: string; start: number }[] {
  return RESOLUTIONS.map((r) => {
    const start = Math.floor(time / r.seconds) * r.seconds;
    return { id: `${asset}:${r.id}:${start}`, res: r.id, start };
  });
}

/**
 * One fill's price, as XCP satoshi per whole token scaled by PRICE_SCALE.
 * `null` for a degenerate fill, which is dropped rather than folded as zero.
 *
 * Rounded half up, not BigInt's truncating divide: flooring biases every price
 * down by up to a unit in the last place — always in the same direction,
 * across every candle — and makes a fill the book quotes at 0.005 store as
 * 0.00499999.
 */
export function fillPrice(xcp: bigint, token: bigint): bigint | null {
  if (token <= 0n || xcp <= 0n) return null;
  const price = (2n * xcp * PRICE_SCALE + token) / (2n * token);
  return price > 0n ? price : null;
}

/**
 * Fold fills into OHLCV buckets.
 *
 * A fill's price is its own two legs divided, not the pool's reserve ratio:
 * an order-book fill never touches the reserves, and pricing it from them
 * would record a price that did not happen.
 *
 * `stored` is what those buckets already hold. An indexer tick sees only the
 * fills past its cursor, so a bucket that spans two ticks must be MERGED into
 * — folding the new fills alone and writing the result would silently replace
 * a day's high, low, and volume with one trade's. Fills at or below a bucket's
 * `lastBlock` are dropped, which is what makes re-reading the boundary block
 * free rather than double-counted. Callers folding a complete set of fills
 * (the web app, or a first-run backfill) pass no `stored` at all.
 */
export function foldCandles(asset: string, fills: Fill[], stored: Stored = new Map()): Candle[] {
  const byBucket = new Map<string, Candle>();
  // Chronological, so the first fill seen in a bucket is genuinely its open
  // and the last is its close.
  for (const fill of [...fills].sort((a, b) => a.time - b.time || a.block - b.block)) {
    if (fill.time <= 0) continue;
    const price = fillPrice(fill.xcp, fill.token);
    if (price === null) continue;
    for (const bucket of bucketIds(asset, fill.time)) {
      const prior = stored.get(bucket.id);
      if (prior && fill.block <= prior.lastBlock) continue; // already folded
      const existing = byBucket.get(bucket.id) ?? prior;
      if (!existing) {
        byBucket.set(bucket.id, {
          id: bucket.id,
          asset,
          resolution: bucket.res,
          bucketStart: bucket.start,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: fill.xcp,
          trades: 1,
          lastBlock: fill.block,
        });
        continue;
      }
      // Carry the stored row forward on first touch so the merge accumulates
      // onto it instead of onto a fresh zero. `open` is never revised — every
      // fill arriving now is later than the one that opened the bucket.
      const merged: Candle = byBucket.get(bucket.id) ?? { ...existing };
      if (price > merged.high) merged.high = price;
      if (price < merged.low) merged.low = price;
      merged.close = price;
      merged.volume += fill.xcp;
      merged.trades += 1;
      if (fill.block > merged.lastBlock) merged.lastBlock = fill.block;
      byBucket.set(bucket.id, merged);
    }
  }
  return [...byBucket.values()];
}
