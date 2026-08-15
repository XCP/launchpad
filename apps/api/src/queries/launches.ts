import { one, q } from "#api/db";
import type { LaunchPhase } from "@launchpad/xcp69/xcp69";

export interface LaunchRow {
  tx_hash: string;
  tx_index: number;
  asset: string;
  asset_longname: string | null;
  source: string;
  divisible: number;
  announce_block: number | null;
  original_deadline: number | null;
  start_block: number;
  end_block: number;
  price: string;
  quantity_by_price: string;
  hard_cap: string;
  soft_cap: string;
  pool_quantity: string | null;
  max_mint_per_tx: string;
  max_mint_per_address: string | null;
  premint_quantity: string;
  minted_asset_commission_int: string | null;
  burn_payment: number;
  lock_quantity: number;
  lock_description: number;
  lp_asset: string | null;
  description: string | null;
  conforming: number | null;
  conformance_version: number;
  status: string;
  phase: string;
  earned_quantity: string | null;
  paid_quantity: string | null;
  current_deadline_block: number;
  mints: number;
  minters: number;
  pool_xcp_reserve: string | null;
  pool_token_reserve: string | null;
  pool_xcp_sats: number;
  seen_at_block: number;
  updated_at: number;
}

const COLUMNS = `tx_hash, tx_index, asset, asset_longname, source, divisible,
  announce_block, original_deadline, start_block, end_block, price,
  quantity_by_price, hard_cap, soft_cap, pool_quantity, max_mint_per_tx,
  max_mint_per_address, premint_quantity, minted_asset_commission_int,
  burn_payment, lock_quantity, lock_description, lp_asset, description,
  conforming, conformance_version, status, phase, earned_quantity,
  paid_quantity, current_deadline_block, mints, minters, pool_xcp_reserve,
  pool_token_reserve, pool_xcp_sats, seen_at_block, updated_at`;

/**
 * The phases, in the order the index page stacks them.
 *
 * This is also the query plan. One statement per phase, each a seek into
 * idx_launches_rank that stops at its own LIMIT, so the rows this reads are
 * bounded by what it returns rather than by how big the table is.
 *
 * It replaced a single window function — ROW_NUMBER() OVER (PARTITION BY phase
 * ORDER BY <rank>) — which was 66% of every row this database read: 204 rows
 * per call from a 44-row table to return about 36, because a computed rank
 * cannot be indexed and SQLite had to sort the whole conforming set to find
 * the top of each phase. The rank now lives in the `rank_key` generated column
 * (migration 0009), which is the only definition of it; nothing here restates
 * the arithmetic, so the two cannot drift.
 *
 * `LaunchPhase` is a closed union of exactly these four, so enumerating them
 * cannot silently drop a phase the way a hardcoded list of an open set would.
 */
const PHASE_ORDER: readonly LaunchPhase[] = [
  "graduated",
  "minting",
  "scheduled",
  "refunded",
] as const;

/** The index page: up to `perPhase` conforming launches per phase, each phase
 *  ranked by the key that phase is actually judged by (see migration 0009).
 *
 *  One `batch`, so four statements still cost one round trip — the point is to
 *  read fewer rows, not to trade a sort for four trips to the database. */
export async function listLaunches(
  db: D1Database,
  perPhase: number,
): Promise<LaunchRow[]> {
  const stmt = db.prepare(
    `SELECT ${COLUMNS} FROM launches
      WHERE conforming = 1 AND phase = ?1
      ORDER BY rank_key DESC, tx_index DESC
      LIMIT ?2`,
  );
  const perPhaseRows = await db.batch<LaunchRow>(
    PHASE_ORDER.map((phase) => stmt.bind(phase, perPhase)),
  );
  // Concatenated in PHASE_ORDER, which is what the old query's trailing
  // ORDER BY CASE phase ... produced — the ordering is now structural rather
  // than something the database has to sort for.
  return perPhaseRows.flatMap((r) => r.results);
}

/** Every conforming launch's ticker — the membership test /v2/mempool needs
 *  to decide which unconfirmed mints this site has an opinion about. A single
 *  column off the partial index, not the full rows the client used to download
 *  to answer the same question. */
export function conformingAssets(db: D1Database): Promise<string[]> {
  return q<{ asset: string }>(
    db,
    `SELECT asset FROM launches WHERE conforming = 1`,
  ).then((rows) => rows.map((r) => r.asset));
}

export interface PhaseCount {
  phase: string;
  n: number;
}

/** How many conforming launches sit in each phase. One grouped read — the
 *  homepage shows a slice per section and needs to say how big the whole is,
 *  and /stats is the same question asked directly. */
export function countByPhase(db: D1Database): Promise<PhaseCount[]> {
  return q<PhaseCount>(
    db,
    `SELECT phase, COUNT(*) AS n FROM launches WHERE conforming = 1 GROUP BY phase`,
  );
}

export function getLaunch(db: D1Database, asset: string): Promise<LaunchRow | null> {
  return one<LaunchRow>(
    db,
    `SELECT ${COLUMNS} FROM launches WHERE asset = ?1`,
    asset,
  );
}

/** A wallet's own launches, newest-announced first. Non-conforming launches
 *  are excluded for the same reason they're excluded everywhere else — this
 *  site shows only XCP-69 — but a NULL verdict is kept, so a launch that was
 *  just created still appears while the indexer resolves it. */
export function getLaunchesBySource(db: D1Database, source: string): Promise<LaunchRow[]> {
  return q<LaunchRow>(
    db,
    `SELECT ${COLUMNS} FROM launches
     WHERE source = ?1 AND conforming IS NOT 0
     ORDER BY announce_block DESC`,
    source,
  );
}

export interface SourceMintRow {
  tx_hash: string;
  launch_tx: string;
  asset: string;
  divisible: number;
  phase: string;
  block_index: number;
  earn_quantity: string;
  paid_quantity: string;
}

/** Every mint an address has made, newest first, with the launch it belongs
 *  to. The ledger alone can't answer this: an `escrowed fairmint` debit is
 *  XCP-only, so nothing in it names the asset being minted.
 *
 *  Non-conforming launches are excluded — this site shows only XCP-69. The
 *  test is `IS NOT 0` rather than `= 1` because NULL means the verdict hasn't
 *  been reached yet, which is not the same as failing it; `= 1` would make a
 *  mint vanish until the indexer catches up. */
export function getMintsBySource(
  db: D1Database,
  source: string,
  limit: number,
): Promise<SourceMintRow[]> {
  return q<SourceMintRow>(
    db,
    `SELECT m.tx_hash, m.launch_tx, l.asset, l.divisible, l.phase,
            m.block_index, m.earn_quantity, m.paid_quantity
     FROM launch_mints m
     JOIN launches l ON l.tx_hash = m.launch_tx
     WHERE m.source = ?1 AND l.conforming IS NOT 0
     ORDER BY m.block_index DESC
     LIMIT ?2`,
    source,
    limit,
  );
}

export interface AssetEventRow {
  event: string;
  asset: string;
  block_index: number;
  token_delta: string;
  xcp_delta: string;
  kind: string;
}

/** An address's trades on XCP-69 assets. One indexed read — the whole point
 *  of the asset_events table is that this replaces paginating the address's
 *  entire Counterparty ledger in the browser. */
export function getEventsBySource(
  db: D1Database,
  address: string,
  limit: number,
): Promise<AssetEventRow[]> {
  return q<AssetEventRow>(
    db,
    `SELECT event, asset, block_index, token_delta, xcp_delta, kind
     FROM asset_events
     WHERE address = ?1
     ORDER BY block_index DESC
     LIMIT ?2`,
    address,
    limit,
  );
}

export interface MinterRow {
  source: string;
  earned: string;
  paid: string;
  mints: number;
}

export interface FeeSummary {
  total_fee_sats: number;
  counted: number;
  mints: number;
}

/** Bitcoin-side cost of a launch's mints, summed once at read time. `counted`
 *  can trail `mints` — a fee lookup can fail (see fetchTxFee) — so the
 *  caller can tell a true zero from an incomplete sample. */
export function sumFees(db: D1Database, launchTx: string): Promise<FeeSummary | null> {
  return one<FeeSummary>(
    db,
    `SELECT CAST(COALESCE(SUM(fee_sats), 0) AS INTEGER) AS total_fee_sats,
            COUNT(fee_sats) AS counted,
            COUNT(*) AS mints
     FROM launch_mints
     WHERE launch_tx = ?1`,
    launchTx,
  );
}

export function listMinters(
  db: D1Database,
  launchTx: string,
  limit: number,
): Promise<MinterRow[]> {
  // Exact sums via SQLite's own arbitrary-precision-free integer add would
  // overflow past 2^63 in principle; token quantities here top out at 1e16,
  // comfortably inside i64, so a plain SUM is safe for this table only.
  return q<MinterRow>(
    db,
    `SELECT source,
            CAST(SUM(CAST(earn_quantity AS INTEGER)) AS TEXT) AS earned,
            CAST(SUM(CAST(paid_quantity AS INTEGER)) AS TEXT) AS paid,
            COUNT(*) AS mints
     FROM launch_mints
     WHERE launch_tx = ?1
     GROUP BY source
     ORDER BY SUM(CAST(earn_quantity AS INTEGER)) DESC
     LIMIT ?2`,
    launchTx,
    limit,
  );
}

export interface ActivityTotals {
  mints: number;
  minters: number;
  /** XCP satoshi paid into every conforming launch, ever. */
  paid_xcp: number;
  /** Bitcoin satoshi spent on mint transaction fees. */
  fee_sats: number;
}

/**
 * Site-wide minting activity, computed from scratch.
 *
 * A full pass over launch_mints is inherent — no index avoids a COUNT or a
 * SUM, and COUNT(DISTINCT) needs a temp b-tree besides. That is why this no
 * longer runs at read time: /v2/stats reads `readMintTotals` below, and this
 * runs only when the indexer sees something that could have changed the
 * answer. See migration 0010.
 *
 * It remains the single definition of what the number MEANS. The rollup stores
 * this query's result rather than accumulating its own counters, so the two
 * cannot disagree — re-deriving always lands where a live query would.
 *
 * Only conforming launches count. A non-conforming fairminter's mints are
 * real, but this site's numbers describe XCP-69, and mixing the two would
 * report activity for launches it refuses to list.
 */
export function activityTotals(db: D1Database): Promise<ActivityTotals[]> {
  return q<ActivityTotals>(
    db,
    `SELECT
       COUNT(*) AS mints,
       COUNT(DISTINCT m.source) AS minters,
       CAST(COALESCE(SUM(CAST(m.paid_quantity AS INTEGER)), 0) AS INTEGER) AS paid_xcp,
       CAST(COALESCE(SUM(m.fee_sats), 0) AS INTEGER) AS fee_sats
     FROM launch_mints m
     JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1`,
  );
}

export interface MintBucket {
  bucket: number;
  n: number;
  minters: number;
}

/**
 * Mints grouped into roughly-daily buckets of 144 blocks, computed from
 * scratch — the rollup's source, not the read path. See `readMintBuckets`.
 *
 * Blocks, not timestamps: launch_mints records the block a mint landed in and
 * nothing else, and 144 blocks is a Bitcoin day by design. The bucket is
 * therefore approximate against a wall clock and exact against the chain,
 * which is the right way round for this — the chart is labelled as
 * approximate rather than pretending to calendar precision.
 *
 * Every bucket, with no lower bound: the rollup stores the whole history and
 * the route slices the window it wants. A window baked in here would go stale
 * every block as height advances, which would mean recomputing constantly for
 * a reason unrelated to whether any mint actually happened.
 */
export function mintsByBucket(db: D1Database): Promise<MintBucket[]> {
  return q<MintBucket>(
    db,
    `SELECT m.block_index / 144 AS bucket,
            COUNT(*) AS n,
            COUNT(DISTINCT m.source) AS minters
       FROM launch_mints m
       JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
      GROUP BY bucket
      ORDER BY bucket`,
  );
}

/** The stored totals — one row by primary key, which is the entire point of
 *  migration 0010. Null only if the rollup row is somehow missing; the
 *  migration seeds it, so the caller's fallback is a belt-and-braces zero
 *  rather than an expected state. */
export function readMintTotals(db: D1Database): Promise<ActivityTotals | null> {
  return one<ActivityTotals>(
    db,
    `SELECT mints, minters, paid_xcp, fee_sats FROM mint_totals WHERE id = 1`,
  );
}

/**
 * The stored buckets from `sinceBucket` on, oldest first.
 *
 * `bucket` is the primary key, so this is an indexed range scan bounded by the
 * chart's own window rather than by how many mints exist.
 *
 * The window is applied in whole buckets, where the live query filtered by
 * block and then grouped. That made the oldest bar a partial day whenever the
 * window opened mid-bucket — a bar that looked like a quiet day but was really
 * a clipped one. Whole buckets is both cheaper and the more honest chart.
 */
export function readMintBuckets(db: D1Database, sinceBucket: number): Promise<MintBucket[]> {
  return q<MintBucket>(
    db,
    `SELECT bucket, n, minters FROM mint_buckets
      WHERE bucket >= ?1 ORDER BY bucket`,
    sinceBucket,
  );
}

export interface MinterEarning {
  source: string;
  mints: number;
  /** Distinct launches this address has minted, so the leaderboard can show
   *  breadth as well as volume — 69 addresses is what a launch needs. */
  launches: number;
  /** Raw XCP satoshi committed across those mints. */
  paid: string;
}

/**
 * Who has minted, most first — the rewards leaderboard.
 *
 * Counted per MINT TRANSACTION rather than per lot, because that is the unit
 * the reward is paid in: the Bitcoin fee a minter is being refunded is
 * charged per transaction, whatever quantity it carries.
 *
 * Conforming launches only, the same editorial line the rest of the site
 * draws — a mint against some other fairminter is a real Counterparty
 * transaction and none of this programme's business.
 */
export function minterEarnings(
  db: D1Database,
  limit: number,
  source?: string,
  offset = 0,
): Promise<MinterEarning[]> {
  // One query for both callers. A profile asking about itself and the
  // leaderboard listing everyone must never report different totals for the
  // same address, which two queries would eventually manage.
  const where = source ? "AND m.source = ?3" : "";
  const binds: (number | string)[] = source
    ? [limit, offset, source]
    : [limit, offset];
  return q<MinterEarning>(
    db,
    `SELECT m.source,
            COUNT(*) AS mints,
            COUNT(DISTINCT m.launch_tx) AS launches,
            CAST(SUM(CAST(m.paid_quantity AS INTEGER)) AS TEXT) AS paid
       FROM launch_mints m
       JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
      WHERE 1 = 1 ${where}
      GROUP BY m.source
      ORDER BY mints DESC, paid DESC
      LIMIT ?1 OFFSET ?2`,
    ...binds,
  );
}
