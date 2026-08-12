import { one, q } from "#api/db";

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
 * The sort key each phase is actually judged by.
 *
 * Not one order for everything: the question "which of these is doing best"
 * has a different answer per phase, and a shared key answers it wrong for two
 * of the three.
 *
 *  - graduated: MARKET CAP. Every XCP-69 token has the same fixed supply, so
 *    ordering by price and ordering by market cap are the same ordering — and
 *    price is the pool's own ratio. This is NOT pool depth, which was the old
 *    key: two pools holding equal XCP can be priced very differently, so depth
 *    ranked the biggest pool rather than the most valuable token.
 *  - minting: PROGRESS toward the soft cap, fullest first — the launches
 *    closest to actually happening.
 *  - scheduled: START BLOCK, latest first.
 *
 * REAL division is fine here and only here: this is a ranking, never a
 * displayed or transacted amount. `tx_index` breaks ties so the order is
 * fully deterministic — two launches that round to the same key must not swap
 * places between two renders of the same data.
 */
const PHASE_RANK = `CASE phase
  WHEN 'graduated' THEN
    CASE WHEN CAST(pool_token_reserve AS REAL) > 0
         THEN CAST(pool_xcp_reserve AS REAL) / CAST(pool_token_reserve AS REAL)
         ELSE 0 END
  WHEN 'minting' THEN
    CASE WHEN CAST(soft_cap AS REAL) > 0
         THEN CAST(earned_quantity AS REAL) / CAST(soft_cap AS REAL)
         ELSE 0 END
  ELSE start_block
END`;

/** The index page in one query: up to `perPhase` conforming launches per
 *  phase, each phase in the order that phase is actually judged by. */
export function listLaunches(
  db: D1Database,
  perPhase: number,
): Promise<LaunchRow[]> {
  return q<LaunchRow>(
    db,
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY phase
         ORDER BY ${PHASE_RANK} DESC, tx_index DESC
       ) AS rn
       FROM launches
       WHERE conforming = 1
     )
     SELECT ${COLUMNS} FROM ranked
     WHERE rn <= ?1
     ORDER BY CASE phase
       WHEN 'graduated' THEN 0 WHEN 'minting' THEN 1
       WHEN 'scheduled' THEN 2 ELSE 3 END, rn`,
    perPhase,
  );
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
 * Site-wide minting activity.
 *
 * Aggregates, so a full pass over launch_mints is inherent — no index avoids
 * a COUNT or a SUM. Bounded instead by caching the answer at the edge, since
 * "how much has been raised in total" is a number nobody needs to the second.
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
 * Mints grouped into roughly-daily buckets of 144 blocks.
 *
 * Blocks, not timestamps: launch_mints records the block a mint landed in and
 * nothing else, and 144 blocks is a Bitcoin day by design. The bucket is
 * therefore approximate against a wall clock and exact against the chain,
 * which is the right way round for this — the chart is labelled as
 * approximate rather than pretending to calendar precision.
 */
export function mintsByBucket(db: D1Database, sinceBlock: number): Promise<MintBucket[]> {
  return q<MintBucket>(
    db,
    `SELECT m.block_index / 144 AS bucket,
            COUNT(*) AS n,
            COUNT(DISTINCT m.source) AS minters
       FROM launch_mints m
       JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
      WHERE m.block_index >= ?1
      GROUP BY bucket
      ORDER BY bucket`,
    sinceBlock,
  );
}
