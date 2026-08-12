import type { PricePoint } from "@/lib/api/counterparty";
import type { ChartCandle } from "@/lib/api/launchpad-api";
import { bucketIds, RESOLUTIONS } from "@launchpad/xcp69/candles";
import { big } from "@/lib/numeric";

export type ChartResolution = "1h" | "1d";

/**
 * Fold live Counterparty fills into the same buckets the indexer writes.
 *
 * This is the fallback path: `price_candles` is a cache, and a launch that
 * graduated minutes ago has traded before the indexer has folded it. Without
 * this the chart would be blank for exactly the window in which a new market
 * is most interesting to look at.
 *
 * Bucket boundaries come from the shared `bucketIds`, not a local `Math.floor`
 * — that is the one part which must agree with the table, or a fill would land
 * in a different candle depending on which source answered.
 *
 * The prices themselves are `PricePoint.price`, already divided by the same
 * derivation the indexer uses (the fill's own two legs). Re-deriving them from
 * a reconstructed token leg would only introduce rounding the table doesn't
 * have.
 */
export function foldPointsToCandles(
  asset: string,
  points: PricePoint[],
  resolution: ChartResolution,
): ChartCandle[] {
  const seconds = RESOLUTIONS.find((r) => r.id === resolution)?.seconds;
  if (!seconds) return [];
  const byBucket = new Map<number, ChartCandle>();

  // Chronological, so a bucket's first point is its open and its last its close.
  for (const p of [...points].sort((a, b) => a.time - b.time || a.block - b.block)) {
    if (p.time <= 0 || !(p.price > 0)) continue;
    const bucket = bucketIds(asset, p.time).find((b) => b.res === resolution);
    if (!bucket) continue;
    const volume = big(p.volumeXcpRaw);
    const existing = byBucket.get(bucket.start);
    if (!existing) {
      byBucket.set(bucket.start, {
        time: bucket.start,
        open: p.price,
        high: p.price,
        low: p.price,
        close: p.price,
        volumeXcpRaw: volume.toString(),
        trades: 1,
        lastBlock: p.block,
      });
      continue;
    }
    existing.high = Math.max(existing.high, p.price);
    existing.low = Math.min(existing.low, p.price);
    existing.close = p.price;
    // Raw XCP satoshi stay exact — summing these as numbers is how a volume
    // figure quietly stops matching the fills it came from.
    existing.volumeXcpRaw = (big(existing.volumeXcpRaw) + volume).toString();
    existing.trades += 1;
    if (p.block > existing.lastBlock) existing.lastBlock = p.block;
  }

  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}
