import {
  fetchAllFairminters,
  fetchAnnounceFacts,
  fetchBlockHeight,
  fetchFairmints,
  fetchPool,
} from "#api/integrations/counterparty";
import {
  isXcp69,
  launchPhase,
  windowIsExact,
  xcp69Params,
  type Fairminter,
} from "@launchpad/xcp69/xcp69";

const CONFORMANCE_VERSION = 1;
const WORKLIST_LIMIT = 15;

const truthy = (raw: unknown) => raw !== null && raw !== undefined && raw !== 0 && raw !== "0";

export interface SyncResult {
  candidates: number;
  written: number;
  resolved: number;
  mints_ingested: number;
}

/**
 * One poll: list every fairminter, keep only the ones whose fixed parameters
 * could conform at all (xcp69Params — free, no subrequest), and mirror just
 * those into D1. Every write is delta-guarded: an unchanged row costs
 * nothing, because D1 bills per row a statement TOUCHES, not per row that
 * changed.
 */
export async function syncLaunches(db: D1Database): Promise<SyncResult> {
  const [all, height] = await Promise.all([fetchAllFairminters(), fetchBlockHeight()]);
  const candidates = all.filter((fm) => fm.asset && xcp69Params(fm));

  let written = 0;
  let mintsIngested = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const fm of candidates) {
    // Pending rows can be judged immediately — their own block_index IS the
    // announcement block until the launch opens and it gets rewritten. Past
    // pending, the verdict needs the creation event (resolved below) and
    // stays NULL (undecided) until then; once decided it is never
    // recomputed here, only by the worklist pass, so a first-time decision
    // is never silently overwritten back to NULL on the next tick.
    const pendingVerdict = fm.status === "pending" ? isXcp69(fm, undefined) : null;

    let poolXcpReserve: string | null = null;
    let poolTokenReserve: string | null = null;
    let poolXcpSats = 0;
    let hasPool = false;
    if (fm.status === "closed" && truthy(fm.pool_quantity)) {
      const pool = await fetchPool(fm.asset);
      if (pool) {
        hasPool = true;
        const xcpIsA = pool.asset_a === "XCP";
        const xcpReserve = xcpIsA ? pool.reserve_a : pool.reserve_b;
        const tokenReserve = xcpIsA ? pool.reserve_b : pool.reserve_a;
        poolXcpReserve = String(xcpReserve);
        poolTokenReserve = String(tokenReserve);
        poolXcpSats = Number(xcpReserve) || 0;
      }
    }
    const phase = launchPhase(fm, hasPool);

    let mints = 0;
    let minters = 0;
    if (fm.status === "open" || fm.status === "closed") {
      const fairmints = await fetchFairmints(fm.tx_hash);
      mints = fairmints.length;
      minters = new Set(fairmints.map((m) => m.source)).size;
      if (fairmints.length > 0) {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO launch_mints
             (tx_hash, launch_tx, block_index, source, earn_quantity, paid_quantity)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        );
        const batch = fairmints.map((m) =>
          stmt.bind(
            m.tx_hash,
            fm.tx_hash,
            m.block_index,
            m.source,
            String(m.earn_quantity),
            String(m.paid_quantity),
          ),
        );
        const results = await db.batch(batch);
        mintsIngested += results.filter((r) => (r.meta.rows_written ?? 0) > 0).length;
      }
    }

    const res = await db
      .prepare(
        `INSERT INTO launches (
           tx_hash, tx_index, asset, asset_longname, source, divisible,
           start_block, end_block, price, quantity_by_price, hard_cap,
           soft_cap, pool_quantity, max_mint_per_tx, max_mint_per_address,
           premint_quantity, minted_asset_commission_int, burn_payment,
           lock_quantity, lock_description, lp_asset, description,
           conforming, conformance_version,
           status, phase, earned_quantity, paid_quantity,
           current_deadline_block, mints, minters,
           pool_xcp_reserve, pool_token_reserve, pool_xcp_sats,
           seen_at_block, updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
           ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ${CONFORMANCE_VERSION},
           ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35
         )
         ON CONFLICT(tx_hash) DO UPDATE SET
           status = excluded.status,
           phase = excluded.phase,
           earned_quantity = excluded.earned_quantity,
           paid_quantity = excluded.paid_quantity,
           current_deadline_block = excluded.current_deadline_block,
           mints = excluded.mints,
           minters = excluded.minters,
           pool_xcp_reserve = excluded.pool_xcp_reserve,
           pool_token_reserve = excluded.pool_token_reserve,
           pool_xcp_sats = excluded.pool_xcp_sats,
           seen_at_block = excluded.seen_at_block,
           updated_at = excluded.updated_at,
           conforming = CASE WHEN ?23 IS NOT NULL THEN ?23 ELSE launches.conforming END
         WHERE launches.status IS NOT excluded.status
            OR launches.phase IS NOT excluded.phase
            OR launches.earned_quantity IS NOT excluded.earned_quantity
            OR launches.paid_quantity IS NOT excluded.paid_quantity
            OR launches.current_deadline_block IS NOT excluded.current_deadline_block
            OR launches.mints IS NOT excluded.mints
            OR launches.minters IS NOT excluded.minters
            OR launches.pool_xcp_reserve IS NOT excluded.pool_xcp_reserve
            OR launches.pool_xcp_sats IS NOT excluded.pool_xcp_sats
            OR (?23 IS NOT NULL AND launches.conforming IS NULL)`,
      )
      .bind(
        fm.tx_hash,
        fm.tx_index,
        fm.asset,
        fm.asset_longname,
        fm.source,
        fm.divisible ? 1 : 0,
        fm.start_block,
        fm.end_block,
        String(fm.price),
        String(fm.quantity_by_price),
        String(fm.hard_cap),
        String(fm.soft_cap),
        fm.pool_quantity === null ? null : String(fm.pool_quantity),
        String(fm.max_mint_per_tx),
        fm.max_mint_per_address === null ? null : String(fm.max_mint_per_address),
        String(fm.premint_quantity),
        fm.minted_asset_commission_int === null
          ? null
          : String(fm.minted_asset_commission_int),
        fm.burn_payment ? 1 : 0,
        fm.lock_quantity ? 1 : 0,
        fm.lock_description ? 1 : 0,
        fm.lp_asset,
        fm.description ?? null,
        pendingVerdict === null ? null : pendingVerdict ? 1 : 0,
        fm.status,
        phase,
        fm.earned_quantity === null ? null : String(fm.earned_quantity),
        fm.paid_quantity === null ? null : String(fm.paid_quantity),
        fm.soft_cap_deadline_block,
        mints,
        minters,
        poolXcpReserve,
        poolTokenReserve,
        poolXcpSats,
        fm.status === "closed" ? fm.block_index : height,
        now,
      )
      .run();

    if ((res.meta.rows_written ?? 0) > 0) written += 1;
  }

  const resolved = await resolveUndecided(db);

  return {
    candidates: candidates.length,
    written,
    resolved,
    mints_ingested: mintsIngested,
  };
}

/** Rows whose parameters match but whose timing verdict is still unknown —
 *  each is asked about exactly once, ever, and drops out of this worklist
 *  the moment it's answered. */
async function resolveUndecided(db: D1Database): Promise<number> {
  const undecided = await db
    .prepare(
      `SELECT tx_hash, asset, source, divisible, start_block, end_block, price,
              quantity_by_price, hard_cap, soft_cap, pool_quantity,
              max_mint_per_tx, max_mint_per_address, premint_quantity,
              minted_asset_commission_int, burn_payment, lock_quantity,
              lock_description, lp_asset, description, status,
              current_deadline_block
       FROM launches WHERE conforming IS NULL ORDER BY tx_index LIMIT ?1`,
    )
    .bind(WORKLIST_LIMIT)
    .all<{
      tx_hash: string;
      asset: string;
      source: string;
      divisible: number;
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
      status: string;
      current_deadline_block: number;
    }>();

  let resolved = 0;
  for (const row of undecided.results) {
    const { announceBlock, originalDeadline } = await fetchAnnounceFacts(row.tx_hash);
    if (announceBlock === null) continue; // not confirmed yet — ask again next tick

    // Reconstructed straight from the stored columns — this is a non-pending
    // row (pending ones are decided in the main pass and never reach this
    // worklist), so block_index/confirmed are irrelevant to the predicate;
    // only announceBlock (passed explicitly below) matters for timing.
    const fm: Fairminter = {
      tx_hash: row.tx_hash,
      tx_index: 0,
      block_index: 0,
      source: row.source,
      asset: row.asset,
      asset_longname: null,
      description: row.description ?? "",
      price: row.price,
      quantity_by_price: row.quantity_by_price,
      hard_cap: row.hard_cap,
      soft_cap: row.soft_cap,
      soft_cap_deadline_block: row.current_deadline_block,
      start_block: row.start_block,
      end_block: row.end_block,
      burn_payment: Boolean(row.burn_payment),
      max_mint_per_tx: row.max_mint_per_tx,
      max_mint_per_address: row.max_mint_per_address,
      premint_quantity: row.premint_quantity,
      minted_asset_commission_int: row.minted_asset_commission_int,
      lock_description: Boolean(row.lock_description),
      lock_quantity: Boolean(row.lock_quantity),
      divisible: Boolean(row.divisible),
      pool_quantity: row.pool_quantity,
      lp_asset: row.lp_asset,
      status: row.status,
      earned_quantity: null,
      paid_quantity: null,
    };

    const conforming =
      isXcp69(fm, announceBlock) &&
      (row.status !== "closed" || windowIsExact(fm, originalDeadline));

    await db
      .prepare(
        `UPDATE launches
         SET announce_block = ?1, original_deadline = ?2, conforming = ?3, updated_at = ?4
         WHERE tx_hash = ?5 AND conforming IS NULL`,
      )
      .bind(announceBlock, originalDeadline, conforming ? 1 : 0, Math.floor(Date.now() / 1000), row.tx_hash)
      .run();
    resolved += 1;
  }
  return resolved;
}
