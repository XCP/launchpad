/**
 * The chain height the indexer last synced against, remembered in D1.
 *
 * Everything that runs after the index pass and needs "now" — the feed's
 * open and closing decisions, the mirror refresh — used to ask the node for
 * it directly. That read lands immediately after the one pass most likely
 * to have tripped the node's rate limit, so under the cooldown it was
 * refused and the whole step threw at zero milliseconds, unrun, with a full
 * outbox behind it. One evening's tail showed the announce job dying this
 * way on every tick while the channel went quiet for over an hour.
 *
 * The height the pass itself fetched is at most one tick stale for any
 * later reader, and nothing downstream is sensitive to that.
 */
import { q } from "#api/db";
import { fetchBlockHeight } from "#api/integrations/counterparty";

const HEIGHT_KEY = "block_height";

/** Record the verified source height, including a shorter replacement chain. */
export async function recordBlockHeight(db: D1Database, height: number): Promise<void> {
  if (!Number.isSafeInteger(height) || height <= 0) return;
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE chain_state.value IS NOT excluded.value`,
    )
    .bind(HEIGHT_KEY, String(height))
    .run();
}

export async function storedBlockHeight(db: D1Database): Promise<number | null> {
  const rows = await q<{ value: string }>(
    db,
    `SELECT value FROM chain_state WHERE key = ?1`,
    HEIGHT_KEY,
  );
  const height = Number(rows[0]?.value);
  return Number.isSafeInteger(height) && height > 0 ? height : null;
}

/** The stored height, or the node's only when nothing has been stored yet —
 *  a fresh database ahead of its first index pass. */
export async function currentHeight(db: D1Database): Promise<number> {
  return (await storedBlockHeight(db)) ?? (await fetchBlockHeight());
}
