import { q } from "#api/db";

const STATE_KEY = "mempool_mint_txids";
const FAST_SYNC_KEY = "mempool_fast_sync_at";

/** Pure comparison kept separate so truncation/deduplication edge cases are
 * unit-testable without pretending a mock is D1. */
export function disappearedMints(previous: string[], current: string[]): number {
  const present = new Set(current);
  return new Set(previous).size === 0
    ? 0
    : [...new Set(previous)].reduce((n, txid) => n + Number(!present.has(txid)), 0);
}

/**
 * Remember the last successful-looking mempool snapshot and report how many
 * transactions disappeared since it.
 *
 * A disappearance is the cheap signal that a block may have confirmed work
 * the five-minute index has not seen yet. False positives are harmless: they
 * run the existing delta-guarded synchronizer once. The stored value changes
 * only when the set changes, so a quiet minute writes no D1 row.
 */
export async function recordMempoolSnapshot(
  db: D1Database,
  txids: string[],
): Promise<{ disappeared: number; pending: number }> {
  const current = [...new Set(txids)].sort();
  const rows = await q<{ value: string }>(
    db,
    `SELECT value FROM chain_state WHERE key = ?1`,
    STATE_KEY,
  );

  let previous: string[] = [];
  try {
    const parsed = JSON.parse(rows[0]?.value ?? "[]");
    if (Array.isArray(parsed)) previous = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // A malformed operational cursor is not chain truth. Replace it with the
    // current snapshot and let the five-minute reconciliation cover the gap.
  }

  const disappeared = disappearedMints(previous, current);
  const encoded = JSON.stringify(current);
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE chain_state.value IS NOT excluded.value`,
    )
    .bind(STATE_KEY, encoded)
    .run();

  return { disappeared, pending: current.length };
}

/**
 * Cap opportunistic full synchronizations even if an upstream outage or a
 * very busy mempool produces repeated disappearance signals. The guarded
 * update is the claim, so concurrent minute/five-minute cron invocations
 * cannot both win it.
 */
export async function claimFastSync(
  db: D1Database,
  minimumIntervalSeconds = 120,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, '0')
       ON CONFLICT(key) DO NOTHING`,
    )
    .bind(FAST_SYNC_KEY)
    .run();
  const claim = await db
    .prepare(
      `UPDATE chain_state SET value = ?1
       WHERE key = ?2 AND CAST(value AS INTEGER) <= ?3`,
    )
    .bind(String(now), FAST_SYNC_KEY, now - minimumIntervalSeconds)
    .run();
  return (claim.meta.rows_written ?? 0) > 0;
}
