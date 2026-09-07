import { q, one } from "#api/db";

/**
 * The programme account per address, precomputed.
 *
 * `getRewardAccount` derives entitlement from the first 10,000 conforming mint
 * transactions globally, with the address predicate deliberately outside that
 * eligibility set. That is correct and it is why the read was the largest row
 * reader on this database: 393 runs a day, 1,898,413 rows read, about 4,830
 * rows to return one. The eligible set does not depend on who is asking, so it
 * is built once here instead of once per asker.
 *
 * Only on ticks where something could have moved it. A quiet tick must not
 * rescan append-only history because five minutes passed.
 */

export interface RewardAccountRow {
  source: string;
  earned_mints: number;
  launches: number;
  paid_quantity: string;
}

export interface RewardRollupResult {
  sources_written: number;
  sources_removed: number;
}

/**
 * Recompute only when an input or its eligibility changed.
 *
 * Mints are the obvious input. `resolved` and `graduations` matter because
 * eligibility is joined to `launches.conforming`, and a launch whose verdict
 * changes adds or removes its mints from the set — so this is not an
 * append-only rollup, and rebuilding must be able to remove an address.
 */
export function rewardAccountsAreStale(counts: {
  mintsIngested: number;
  resolved: number;
  graduations: number;
}): boolean {
  return counts.mintsIngested > 0 || counts.resolved > 0 || counts.graduations > 0;
}

/**
 * The eligibility fold, verbatim from `getRewardAccount` minus its `WHERE
 * source = ?` — the one difference between the two, kept adjacent so they
 * cannot drift into disagreeing about who earned what.
 */
const ELIGIBLE_BY_SOURCE = `
  WITH eligible AS (
    SELECT m.tx_hash, m.launch_tx, m.block_index, m.tx_index,
           m.source, m.paid_quantity
      FROM launch_mints m
      JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
     ORDER BY m.block_index, COALESCE(m.tx_index, 0), m.tx_hash
     LIMIT 10000
  )
  SELECT source,
         COUNT(*) AS earned_mints,
         COUNT(DISTINCT launch_tx) AS launches,
         CAST(SUM(CAST(paid_quantity AS INTEGER)) AS TEXT) AS paid_quantity
    FROM eligible
   GROUP BY source`;

export async function refreshRewardAccounts(db: D1Database): Promise<RewardRollupResult> {
  const [computed, stored] = await Promise.all([
    q<RewardAccountRow>(db, ELIGIBLE_BY_SOURCE),
    q<RewardAccountRow>(
      db,
      `SELECT source, earned_mints, launches, paid_quantity FROM reward_accounts`,
    ),
  ]);

  const before = new Map(stored.map((row) => [row.source, row]));
  const statements: D1PreparedStatement[] = [];

  for (const row of computed) {
    const previous = before.get(row.source);
    before.delete(row.source);
    // D1 bills every row a statement touches, not every row that changed, so a
    // rewrite of an unchanged account is a real cost on a table with one row
    // per participant.
    if (
      previous &&
      previous.earned_mints === row.earned_mints &&
      previous.launches === row.launches &&
      previous.paid_quantity === row.paid_quantity
    ) {
      continue;
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO reward_accounts (source, earned_mints, launches, paid_quantity)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(source) DO UPDATE SET
             earned_mints = excluded.earned_mints,
             launches = excluded.launches,
             paid_quantity = excluded.paid_quantity`,
        )
        .bind(row.source, row.earned_mints, row.launches, row.paid_quantity),
    );
  }

  // Whatever is left in `before` no longer earns: its launch stopped
  // conforming, or its mints fell outside the 10,000. Leaving the row would
  // keep paying a claim the fold no longer supports.
  const removed = [...before.keys()];
  for (const source of removed) {
    statements.push(db.prepare(`DELETE FROM reward_accounts WHERE source = ?1`).bind(source));
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO reward_account_state (id, built_at, sources)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, sources = excluded.sources`,
      )
      .bind(Math.floor(Date.now() / 1000), computed.length),
  );

  // The state row is written in the same batch as the rows it vouches for, so
  // a partial rebuild cannot leave the fast path pointing at half an answer.
  await db.batch(statements);

  return { sources_written: statements.length - removed.length - 1, sources_removed: removed.length };
}

/** Whether a rebuild has ever completed. Absent means: derive it live. */
export async function rewardRollupIsBuilt(db: D1Database): Promise<boolean> {
  const row = await one<{ built_at: number }>(
    db,
    `SELECT built_at FROM reward_account_state WHERE id = 1`,
  );
  return row !== null;
}
