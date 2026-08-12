import { q } from "#api/db";

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
