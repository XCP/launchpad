import { q } from "#api/db";
import { fillPrice } from "@launchpad/xcp69/candles";

export interface CandleRow {
  bucket_start: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_xcp: string;
  trades: number;
  /** Highest block in the bucket. The asset page uses it to place the
   *  creator's trades — which it knows only by block — in the right candle. */
  last_block: number;
}

/** Resolutions the indexer actually folds. Anything else is a 400, not an
 *  empty series — an unrecognised resolution is a bug in the caller, and
 *  answering it with `[]` hides that behind a blank chart. */
export const RESOLUTIONS = new Set(["1h", "1d"]);

/**
 * One asset's OHLCV series, oldest first.
 *
 * `LIMIT` applies to the NEWEST buckets — a chart wants the most recent N,
 * not the first N ever — so the window is taken descending in a subquery and
 * flipped to chronological for the caller, which is the order a series is
 * plotted in.
 *
 * Prices are XCP satoshi per whole token scaled by 1e8, as TEXT. They stay
 * strings all the way to the browser; parsing them into a float here is how a
 * chart quietly stops matching the trades it plots.
 */
export function getCandles(
  db: D1Database,
  asset: string,
  resolution: string,
  limit: number,
): Promise<CandleRow[]> {
  return q<CandleRow>(
    db,
    `SELECT bucket_start, open, high, low, close, volume_xcp, trades, last_block FROM (
       SELECT bucket_start, open, high, low, close, volume_xcp, trades, last_block
         FROM price_candles
        WHERE asset = ?1 AND resolution = ?2
        ORDER BY bucket_start DESC
        LIMIT ?3
     ) ORDER BY bucket_start ASC`,
    asset,
    resolution,
    limit,
  );
}

/** The hourly bucket that was current 24 hours before `nowSeconds`. Aligned
 *  to the candle grid so "what did this trade at a day ago" has one answer
 *  per hour rather than one per request, which is also what lets the edge
 *  cache serve the same answer to everyone who asks within it. */
export function dayAgoBucket(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.floor((nowSeconds - 86_400) / 3_600) * 3_600;
}

/**
 * Each asset's price as of `at`: the close of the newest hourly candle that
 * had started by then. A pair that has not traded for a while carries its
 * last close forward, which is what its price was. An asset with no candle
 * by `at` is absent rather than zero — what an untraded pool was worth is a
 * fact about its reserves, not this table, and `openingPrice` answers it.
 *
 * One statement per asset in a single batch. Each is a seek on
 * idx_price_candles_series that stops at its first row, so N assets read N
 * rows; a single statement over `asset IN (...)` would scan every hourly
 * candle those assets have ever printed to find the same N.
 */
export async function hourlyCloseAt(
  db: D1Database,
  assets: string[],
  at: number,
): Promise<Map<string, bigint>> {
  const unique = [...new Set(assets)];
  if (unique.length === 0) return new Map();
  const stmt = db.prepare(
    `SELECT close FROM price_candles
      WHERE asset = ?1 AND resolution = '1h' AND bucket_start <= ?2
      ORDER BY bucket_start DESC
      LIMIT 1`,
  );
  const results = await db.batch<{ close: string }>(unique.map((a) => stmt.bind(a, at)));
  const out = new Map<string, bigint>();
  results.forEach((r, i) => {
    const row = r.results[0];
    if (row) out.set(unique[i]!, BigInt(row.close));
  });
  return out;
}

/**
 * What a graduated pool traded at before anyone traded: the raise against the
 * reserve the standard escrows beside it — 690 XCP for 31M tokens. That is
 * the price the market opened at, and so the price it was at any moment
 * before its first fill. It is NOT the mint price: the 69/31 split opens the
 * pool 2.23× above what minters paid, and a 24-hour change that measured a
 * fresh graduate from the mint price would report the launch's structural
 * premium as a day's trading.
 *
 * Same unit as a candle close, by the same rounding (`fillPrice`).
 */
export function openingPrice(
  paidQuantity: string | null,
  poolQuantity: string | null,
): bigint | null {
  if (!paidQuantity || !poolQuantity) return null;
  return fillPrice(BigInt(paidQuantity), BigInt(poolQuantity));
}
