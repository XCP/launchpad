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

/** The index page in one query: up to `perPhase` conforming launches per
 *  phase, newest-announced first (deepest-pool first for graduated). */
export function listLaunches(
  db: D1Database,
  perPhase: number,
): Promise<LaunchRow[]> {
  return q<LaunchRow>(
    db,
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY phase
         ORDER BY CASE WHEN phase = 'graduated' THEN pool_xcp_sats ELSE announce_block END DESC
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

export function getLaunch(db: D1Database, asset: string): Promise<LaunchRow | null> {
  return one<LaunchRow>(
    db,
    `SELECT ${COLUMNS} FROM launches WHERE asset = ?1`,
    asset,
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
