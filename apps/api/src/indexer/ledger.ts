/**
 * Re-parse detection: notice when Counterparty Core's ledger changed under
 * blocks this index has already taken, and roll the index back to the last
 * block that still matches.
 *
 * Core stamps every block with a `ledger_hash` and a `messages_hash` that
 * chain over everything it has parsed. They change for a block only when Core
 * parsed it differently: a Bitcoin reorg, or an upgrade whose rollback
 * re-parses from an activation height (Core 11.5 does exactly that to a node
 * that stayed on 11.4 past block 969,320). A snapshot mirror cannot see
 * either from the listings alone. Append-only rows (mints, trade events,
 * candles) would keep what the old ledger said forever.
 *
 * Each tick compares the node's newest WINDOW blocks with what was recorded,
 * one small read on each side; a quiet tick inserts the block or two that
 * are new and nothing else.
 */
import { q } from "#api/db";
import { fetchBlockHashes, type CpBlockHashes } from "#api/integrations/counterparty";
import { COMMUNITY_ROLLUP_STALE_KEY } from "#api/queries/communities";
import { BURN_RESCAN_KEY } from "#api/telegram/burns";

/** Blocks compared each tick. Five-minute ticks see one or two new blocks. */
const WINDOW = 12;
/** Blocks kept, and how far back one deeper read looks for the fork point. */
const RETAIN = 144;
const SQL_VAR_LIMIT = 100;

interface StoredBlock {
  block_index: number;
  ledger_hash: string;
  messages_hash: string | null;
}

export interface LedgerCheck {
  /** Recorded blocks compared with the node this tick. */
  compared: number;
  /** Blocks newly recorded. */
  recorded: number;
  /** The last block that still matched, when a re-parse was found; the index was rolled back to it. */
  rolled_back_to: number | null;
  /** True when every recorded block the node could still be asked about differed, so the fork
   *  point is the oldest block compared minus one rather than a block seen to match. */
  fork_below_window: boolean;
}

const differs = (stored: StoredBlock, api: CpBlockHashes) =>
  stored.ledger_hash !== api.ledger_hash
  || (stored.messages_hash !== null && api.messages_hash !== null && stored.messages_hash !== api.messages_hash);

async function storedFrom(db: D1Database, lowest: number): Promise<StoredBlock[]> {
  return q<StoredBlock>(
    db,
    `SELECT block_index, ledger_hash, messages_hash FROM indexed_blocks WHERE block_index >= ?1 ORDER BY block_index`,
    lowest,
  );
}

/**
 * The lowest recorded block the node now disagrees with, or null. A recorded
 * block above the node's newest is gone from its ledger (a reorg to a shorter
 * chain) and counts as a disagreement.
 */
function firstMismatch(stored: StoredBlock[], api: Map<number, CpBlockHashes>, apiTop: number): number | null {
  for (const row of stored) {
    const theirs = api.get(row.block_index);
    if (theirs ? differs(row, theirs) : row.block_index > apiTop) return row.block_index;
  }
  return null;
}

export async function checkLedger(db: D1Database): Promise<LedgerCheck> {
  const recent = (await fetchBlockHashes(WINDOW)).filter((b) => b.ledger_hash !== null);
  if (recent.length === 0) return { compared: 0, recorded: 0, rolled_back_to: null, fork_below_window: false };
  const api = new Map(recent.map((b) => [b.block_index, b]));
  const apiTop = Math.max(...api.keys());
  let apiLowest = Math.min(...api.keys());
  let stored = await storedFrom(db, apiLowest);
  let mismatch = firstMismatch(stored, api, apiTop);

  // The whole window disagrees: the fork is older than it. One deeper read,
  // as far back as anything is kept, finds the block where the two agree.
  if (mismatch !== null && mismatch <= apiLowest) {
    const deeper = (await fetchBlockHashes(RETAIN, apiLowest - 1)).filter((b) => b.ledger_hash !== null);
    for (const b of deeper) api.set(b.block_index, b);
    apiLowest = Math.min(...api.keys());
    stored = await storedFrom(db, apiLowest);
    mismatch = firstMismatch(stored, api, apiTop);
  }

  const compared = stored.filter((row) => api.has(row.block_index)).length;
  let rolledBackTo: number | null = null;
  let forkBelowWindow = false;
  if (mismatch !== null) {
    const matchedBelow = stored.some((row) => row.block_index < mismatch! && !differs(row, api.get(row.block_index)!));
    forkBelowWindow = !matchedBelow;
    rolledBackTo = mismatch - 1;
    const rollback = await rollbackIndexTo(db, rolledBackTo);
    console.warn({
      event: "ledger_reparse_detected",
      first_changed_block: mismatch,
      rolled_back_to: rolledBackTo,
      fork_below_window: forkBelowWindow,
      ...rollback,
    });
    stored = stored.filter((row) => row.block_index <= rolledBackTo!);
  }

  const known = new Set(stored.map((row) => row.block_index));
  const fresh = [...api.values()].filter((b) => !known.has(b.block_index) && b.block_index >= apiTop - RETAIN);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO indexed_blocks (block_index, ledger_hash, messages_hash) VALUES (?1, ?2, ?3)`,
  );
  const statements = fresh.map((b) => insert.bind(b.block_index, b.ledger_hash, b.messages_hash));
  if (fresh.length > 0) {
    statements.push(db.prepare(`DELETE FROM indexed_blocks WHERE block_index < ?1`).bind(apiTop - RETAIN));
    await db.batch(statements);
  }

  return {
    compared,
    recorded: fresh.length,
    rolled_back_to: rolledBackTo,
    fork_below_window: forkBelowWindow,
  };
}

export interface RollbackResult {
  mints_removed: number;
  launches_removed: number;
  burns_removed: number;
  buyers_removed: number;
  event_assets_reset: number;
}

const CURSOR_PREFIX = "events_hw:";
const POOL_PREFIX = "events_pool:";

/**
 * Forget everything the index took from blocks after `block`, so the next pass
 * re-reads it from the node's current ledger. One batch, so a failure leaves
 * the index exactly as it was.
 *
 * What comes from the chain is rolled back; what records something that
 * happened off it is not.
 *
 * - Mints after the block are deleted, and their launches' `earned_quantity`
 *   cleared: that value is what tells the next pass a launch's mint history
 *   needs reading, and it must not match by coincidence. The crown is
 *   recomputed from the mints that remain.
 * - Launches announced after the block are deleted; the next listing brings
 *   back the ones the node still has, and any it no longer has stay gone.
 * - A traded asset whose event cursor passed the block loses its events after
 *   it, its candles, and both cursors, so its next pass is a first run: the
 *   authoritative refold from block 0. A buyer whose every buy was after the
 *   block leaves `behavior_buyers`; the refold adds back the ones still true.
 * - Burns after the block are deleted and their launches' burned supply
 *   summed again from the burns that remain. The burn scan's cursors are
 *   Core's tx_index and event_index, which a re-parse hands out again from
 *   the fork, so they cannot be rewound to a block: the scan is told to
 *   re-read by block from the one after this, and it resets both cursors to
 *   what it finds.
 *
 * The rollups summarising mints and trades are not touched here; the pass
 * that follows rebuilds them from what remains. The community rollup, which
 * otherwise waits hours, is marked stale so the next tick rebuilds it.
 */
export async function rollbackIndexTo(db: D1Database, block: number): Promise<RollbackResult> {
  const cursors = await q<{ key: string }>(
    db,
    `SELECT key FROM chain_state
      WHERE key >= 'events_hw:' AND key < 'events_hw;' AND CAST(value AS INTEGER) > ?1`,
    block,
  );
  const assets = cursors.map((row) => row.key.slice(CURSOR_PREFIX.length));

  // Deliberately absent: `announced`, `announcement_work`, and the reward
  // tables. A Telegram post that went out and a reward batch that was frozen
  // or sent are records of things that happened off the chain; a re-parse
  // cannot unsay the post or unsend the payment, so their records stay. Reward
  // batches only ever take mints six blocks deep (scripts/reward-batch.mjs).
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE launches SET earned_quantity = NULL
        WHERE tx_hash IN (SELECT DISTINCT launch_tx FROM launch_mints WHERE block_index > ?1)`,
    ).bind(block),
    db.prepare(`DELETE FROM launch_mints WHERE block_index > ?1`).bind(block),
    db.prepare(
      `UPDATE launches
          SET last_mint_block = (SELECT MAX(m.block_index) FROM launch_mints m WHERE m.launch_tx = launches.tx_hash),
              last_mint_count = (SELECT COUNT(*) FROM launch_mints m
                                  WHERE m.launch_tx = launches.tx_hash
                                    AND m.block_index = (SELECT MAX(n.block_index) FROM launch_mints n
                                                          WHERE n.launch_tx = launches.tx_hash)),
              last_mint_tx_index = (SELECT MAX(m.tx_index) FROM launch_mints m
                                     WHERE m.launch_tx = launches.tx_hash
                                       AND m.block_index = (SELECT MAX(n.block_index) FROM launch_mints n
                                                             WHERE n.launch_tx = launches.tx_hash))
        WHERE last_mint_block > ?1`,
    ).bind(block),
    db.prepare(`DELETE FROM launches WHERE announce_block > ?1`).bind(block),
    // Before the events go: which buyers to reconsider is read from them.
    db.prepare(
      `DELETE FROM behavior_buyers
        WHERE address IN (SELECT address FROM asset_events WHERE block_index > ?1 AND kind = 'buy')
          AND NOT EXISTS (SELECT 1 FROM asset_events e
                           WHERE e.address = behavior_buyers.address
                             AND e.kind = 'buy' AND e.block_index <= ?1)`,
    ).bind(block),
    db.prepare(`DELETE FROM asset_events WHERE block_index > ?1`).bind(block),
    // Same sum as reconcileBurnedSupply, without the burns about to go, and
    // only for the launches they touched.
    db.prepare(
      `UPDATE launches
          SET burned_quantity = CAST(COALESCE((
            SELECT SUM(CAST(b.quantity AS INTEGER))
              FROM token_burns b
             WHERE b.asset = launches.asset
               AND b.tx_index > launches.tx_index
               AND b.block_index <= ?1
          ), 0) AS TEXT)
        WHERE asset IN (SELECT asset FROM token_burns WHERE block_index > ?1)`,
    ).bind(block),
    db.prepare(`DELETE FROM token_burns WHERE block_index > ?1`).bind(block),
    // The count is kept by an insert trigger, so a delete has to restate it.
    db.prepare(
      `UPDATE burn_totals SET burns = (SELECT COUNT(*) FROM token_burns)
        WHERE id = 1 AND burns IS NOT (SELECT COUNT(*) FROM token_burns)`,
    ),
    db.prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CAST(excluded.value AS INTEGER) < CAST(chain_state.value AS INTEGER)`,
    ).bind(BURN_RESCAN_KEY, String(block + 1)),
    db.prepare(`INSERT OR IGNORE INTO chain_state (key, value) VALUES (?1, '1')`).bind(COMMUNITY_ROLLUP_STALE_KEY),
    db.prepare(`DELETE FROM indexed_blocks WHERE block_index > ?1`).bind(block),
  ];
  const MINTS = 1;
  const LAUNCHES = 3;
  const BUYERS = 4;
  const BURNS = 7;
  for (let i = 0; i < assets.length; i += SQL_VAR_LIMIT) {
    const chunk = assets.slice(i, i + SQL_VAR_LIMIT);
    const places = chunk.map((_, idx) => `?${idx + 1}`).join(",");
    statements.push(db.prepare(`DELETE FROM price_candles WHERE asset IN (${places})`).bind(...chunk));
    const keys = chunk.flatMap((asset) => [`${CURSOR_PREFIX}${asset}`, `${POOL_PREFIX}${asset}`]);
    statements.push(
      db.prepare(`DELETE FROM chain_state WHERE key IN (${keys.map((_, idx) => `?${idx + 1}`).join(",")})`)
        .bind(...keys),
    );
  }

  const results = await db.batch(statements);
  return {
    mints_removed: results[MINTS]!.meta.rows_written ?? 0,
    launches_removed: results[LAUNCHES]!.meta.rows_written ?? 0,
    burns_removed: results[BURNS]!.meta.rows_written ?? 0,
    buyers_removed: results[BUYERS]!.meta.rows_written ?? 0,
    event_assets_reset: assets.length,
  };
}
