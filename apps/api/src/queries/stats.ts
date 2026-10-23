import { one, q } from "#api/db";

export const STATS_BUCKETS = 90;
export const STATS_BLOCKS_PER_BUCKET = 144;

export async function statsHeight(db: D1Database): Promise<number> {
  const row = await one<{ height: number }>(db,
    "SELECT CAST(value AS INTEGER) AS height FROM chain_state WHERE key = 'block_height'");
  return row?.height ?? 0;
}

export interface TradeActivityBucket {
  bucket: number;
  n: number;
  xcp: string;
}

/** Use the existing partial block index; the maker's mirror row must never
 * double a book fill. Both buys and sells contribute positive gross volume. */
export function tradeActivityByBucket(db: D1Database, startBlock: number, endBlock: number) {
  return q<TradeActivityBucket>(db,
    `SELECT e.block_index / 144 AS bucket, COUNT(*) AS n,
            CAST(SUM(ABS(CAST(e.xcp_delta AS INTEGER))) AS TEXT) AS xcp
       FROM asset_events e
      WHERE e.primary_actor = 1 AND e.block_index BETWEEN ?1 AND ?2
        AND EXISTS (SELECT 1 FROM launches l WHERE l.asset = e.asset AND l.conforming = 1)
      GROUP BY bucket ORDER BY bucket`, startBlock, endBlock);
}

export interface BurnActivityBucket {
  bucket: number;
  asset: string;
  divisible: number;
  n: number;
  quantity: string;
}

/** The burn index contains holder SENDs and explicit destructions, excluding
 * failed-mint cleanup and LP tokens. Keep quantities per asset, as exact raw
 * integers: unrelated token units cannot be added into an ecosystem total.
 * CROSS JOIN keeps the indexed block range as the outer scan, followed by
 * a unique asset lookup, instead of rescanning burns for every launch. */
export function burnActivityByBucket(db: D1Database, startBlock: number, endBlock: number) {
  return q<BurnActivityBucket>(db,
    `SELECT b.block_index / 144 AS bucket, b.asset, l.divisible,
            COUNT(*) AS n, CAST(SUM(CAST(b.quantity AS INTEGER)) AS TEXT) AS quantity
       FROM token_burns b
       CROSS JOIN launches l ON l.asset = b.asset AND l.conforming = 1
      WHERE b.block_index BETWEEN ?1 AND ?2 AND b.tx_index > l.tx_index
      GROUP BY bucket, b.asset ORDER BY bucket, b.asset`, startBlock, endBlock);
}
