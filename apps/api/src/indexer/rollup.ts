import { q } from "#api/db";
import { activityTotals, mintsByBucket, type MintBucket } from "#api/queries/launches";

/**
 * The /v2/stats rollup: the site-wide mint aggregates, recomputed at write
 * time so the read path is a primary-key lookup instead of three full passes
 * over launch_mints. See migration 0010 for why this is worth doing at all.
 *
 * Recompute-and-store, never accumulate. Both numbers come from running the
 * same aggregate queries the API used to run per request — this file adds no
 * arithmetic of its own — so a recompute always lands exactly where a live
 * query would have. That is what makes a rollup safe here: the failure mode of
 * a running counter (drift you cannot detect without recomputing anyway) does
 * not exist.
 *
 * Every write is delta-guarded, per this repo's history with D1. A recompute
 * that finds nothing new touches rows to check and writes none.
 */

/** Bounds the DELETE's bound-parameter list, same ceiling as everywhere else
 *  in this indexer. A bucket is ~a day of chain, so this is years of history
 *  in one statement; the chunking is for the pathological case, not the real
 *  one. */
const SQL_VAR_LIMIT = 100;

export interface RollupResult {
  totals_written: number;
  buckets_written: number;
}

/**
 * Whether anything could have moved the aggregates since the last pass.
 *
 * A mint landing is the obvious one. A fee backfill changes fee_sats without
 * changing the mint count. A resolved conformance verdict changes which mints
 * count at all — including retroactively, if a launch is judged NOT
 * conforming and its mints drop out of every total.
 *
 * Deliberately not triggered by `written` (launch rows changed): a launch row
 * whose earned_quantity moved means a mint landed, and that already shows up
 * as mints_ingested. Triggering on `written` would fire on nearly every tick
 * and cost exactly what this is meant to save.
 */
export function rollupIsStale(counts: {
  mintsIngested: number;
  feesBackfilled: number;
  resolved: number;
}): boolean {
  return counts.mintsIngested > 0 || counts.feesBackfilled > 0 || counts.resolved > 0;
}

export async function refreshRollup(db: D1Database): Promise<RollupResult> {
  const [totalsRows, buckets] = await Promise.all([
    activityTotals(db),
    mintsByBucket(db),
  ]);
  const totals = totalsRows[0] ?? {
    mints: 0,
    minters: 0,
    paid_xcp: 0,
    fee_sats: 0,
    fee_samples: 0,
    median_fee_sats: 0,
  };
  const now = Math.floor(Date.now() / 1000);

  const totalsRes = await db
    .prepare(
      `INSERT INTO mint_totals (
         id, mints, minters, paid_xcp, fee_sats, fee_samples,
         median_fee_sats, updated_at
       )
       VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         mints = excluded.mints,
         minters = excluded.minters,
         paid_xcp = excluded.paid_xcp,
         fee_sats = excluded.fee_sats,
         fee_samples = excluded.fee_samples,
         median_fee_sats = excluded.median_fee_sats,
         updated_at = excluded.updated_at
       WHERE mint_totals.mints IS NOT excluded.mints
          OR mint_totals.minters IS NOT excluded.minters
          OR mint_totals.paid_xcp IS NOT excluded.paid_xcp
          OR mint_totals.fee_sats IS NOT excluded.fee_sats
          OR mint_totals.fee_samples IS NOT excluded.fee_samples
          OR mint_totals.median_fee_sats IS NOT excluded.median_fee_sats`,
    )
    .bind(
      totals.mints,
      totals.minters,
      totals.paid_xcp,
      totals.fee_sats,
      totals.fee_samples,
      totals.median_fee_sats,
      now,
    )
    .run();

  const bucketsWritten = await writeBuckets(db, buckets);

  return {
    totals_written: totalsRes.meta.rows_written ?? 0,
    buckets_written: bucketsWritten,
  };
}

/**
 * Upsert every computed bucket, then drop any stored bucket that no longer
 * exists.
 *
 * The delete is not hypothetical tidiness: mints are append-only, but the set
 * of CONFORMING mints is not — a launch judged non-conforming takes its mints
 * out of the aggregate, and a bucket that held only that launch's mints has to
 * disappear rather than sit there at its old count forever. Guarded upserts
 * alone can only ever add or raise, never remove.
 */
async function writeBuckets(db: D1Database, buckets: MintBucket[]): Promise<number> {
  let written = 0;

  if (buckets.length > 0) {
    const stmt = db.prepare(
      `INSERT INTO mint_buckets (bucket, n, minters) VALUES (?1, ?2, ?3)
       ON CONFLICT(bucket) DO UPDATE SET
         n = excluded.n,
         minters = excluded.minters
       WHERE mint_buckets.n IS NOT excluded.n
          OR mint_buckets.minters IS NOT excluded.minters`,
    );
    for (let i = 0; i < buckets.length; i += SQL_VAR_LIMIT) {
      const chunk = buckets.slice(i, i + SQL_VAR_LIMIT);
      const results = await db.batch(
        chunk.map((b) => stmt.bind(b.bucket, b.n, b.minters)),
      );
      written += results.reduce((sum, r) => sum + (r.meta.rows_written ?? 0), 0);
    }
  }

  // Read first, delete only what is actually orphaned. `DELETE ... WHERE
  // bucket NOT IN (<every bucket>)` would touch — and therefore bill — every
  // row in the table on every recompute to delete nothing, which is the exact
  // shape this whole change exists to avoid.
  const stored = await q<{ bucket: number }>(db, `SELECT bucket FROM mint_buckets`);
  const live = new Set(buckets.map((b) => b.bucket));
  const orphaned = stored.map((r) => r.bucket).filter((b) => !live.has(b));

  for (let i = 0; i < orphaned.length; i += SQL_VAR_LIMIT) {
    const chunk = orphaned.slice(i, i + SQL_VAR_LIMIT);
    const placeholders = chunk.map((_, idx) => `?${idx + 1}`).join(",");
    const res = await db
      .prepare(`DELETE FROM mint_buckets WHERE bucket IN (${placeholders})`)
      .bind(...chunk)
      .run();
    written += res.meta.rows_written ?? 0;
  }

  return written;
}
