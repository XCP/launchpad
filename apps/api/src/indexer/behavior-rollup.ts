import { q } from "#api/db";
import { EXIT_DUST_DIVISOR, EXIT_DUST_RAW } from "#api/behavior-policy";

const SQL_VAR_LIMIT = 100;

export interface WalletBehaviorRollup {
  address: string;
  minted_launches: number;
  holding_launches: number;
  traded_launches: number;
  immediate_dump_launches: number;
  later_dump_launches: number;
  exited_launches: number;
  graduated_launches: number;
  graduated_no_sale_launches: number;
  sold_launches: number;
  seller_remaining_launches: number;
  redeployed_after_sale: number;
  redeployed_paid_raw: string;
}

export interface BehaviorRollupResult {
  wallets_written: number;
  totals_written: number;
}

const walletChanged = (
  next: WalletBehaviorRollup,
  stored: WalletBehaviorRollup | undefined,
): boolean =>
  !stored ||
  next.minted_launches !== stored.minted_launches ||
  next.holding_launches !== stored.holding_launches ||
  next.traded_launches !== stored.traded_launches ||
  next.immediate_dump_launches !== stored.immediate_dump_launches ||
  next.later_dump_launches !== stored.later_dump_launches ||
  next.exited_launches !== stored.exited_launches ||
  next.graduated_launches !== stored.graduated_launches ||
  next.graduated_no_sale_launches !== stored.graduated_no_sale_launches ||
  next.sold_launches !== stored.sold_launches ||
  next.seller_remaining_launches !== stored.seller_remaining_launches ||
  next.redeployed_after_sale !== stored.redeployed_after_sale ||
  next.redeployed_paid_raw !== stored.redeployed_paid_raw;

/** Recompute only when an input or its eligibility changed. A quiet cron tick
 * must not rescan append-only history merely because five minutes passed. */
export function behaviorRollupIsStale(counts: {
  mintsIngested: number;
  eventsIngested: number;
  resolved: number;
  graduations: number;
}): boolean {
  return (
    counts.mintsIngested > 0 ||
    counts.eventsIngested > 0 ||
    counts.resolved > 0 ||
    counts.graduations > 0
  );
}

/**
 * Materialize sitewide wallet behavior at write time.
 *
 * This is deliberately a full, authoritative recompute rather than running
 * counters: a later sale can change a launch from "holding" to "exited", and
 * a conformance verdict can remove history. Recomputing only on a changed
 * tick avoids drift while removing this growing fold from every public cache
 * miss. The stored materialization is loaded once and diffed in memory before
 * preparing writes. Relying only on an UPSERT's WHERE guard would prevent
 * physical writes, but it would still issue one conflict statement (and its
 * primary-key read) for every historical wallet whenever one trade arrived.
 */
export async function refreshBehaviorRollup(
  db: D1Database,
): Promise<BehaviorRollupResult> {
  const wallets = await q<WalletBehaviorRollup>(
    db,
    `WITH settings AS (
       SELECT fast_exit_blocks FROM behavior_settings WHERE id = 1
     ), minted AS (
       SELECT l.asset, m.source, l.phase, l.last_mint_block AS launch_block,
              SUM(CAST(m.earn_quantity AS INTEGER)) AS minted_quantity
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx
        WHERE l.conforming = 1
        GROUP BY l.asset, m.source, l.phase, l.last_mint_block
     ), market AS (
       SELECT e.asset, e.address,
              SUM(CASE WHEN e.kind = 'buy' AND CAST(e.token_delta AS INTEGER) > 0
                       THEN CAST(e.token_delta AS INTEGER) ELSE 0 END) AS bought_quantity,
              SUM(CASE WHEN e.kind = 'sell' AND CAST(e.token_delta AS INTEGER) < 0
                       THEN -CAST(e.token_delta AS INTEGER) ELSE 0 END) AS sold_quantity,
              SUM(CASE WHEN e.kind = 'buy' THEN 1 ELSE 0 END) AS buy_count,
              SUM(CASE WHEN e.kind = 'sell' THEN 1 ELSE 0 END) AS sell_count,
              MIN(CASE WHEN e.kind = 'sell' THEN e.block_index END) AS first_sell_block
         FROM asset_events e
        GROUP BY e.asset, e.address
     ), per_minter AS (
       SELECT m.asset, m.source, m.phase, m.launch_block, m.minted_quantity,
              COALESCE(k.bought_quantity, 0) AS bought_quantity,
              COALESCE(k.sold_quantity, 0) AS sold_quantity,
              COALESCE(k.buy_count, 0) AS buy_count,
              COALESCE(k.sell_count, 0) AS sell_count,
              k.first_sell_block,
              m.minted_quantity + COALESCE(k.bought_quantity, 0) AS acquired_quantity,
              m.minted_quantity + COALESCE(k.bought_quantity, 0) -
                COALESCE(k.sold_quantity, 0) AS remaining_quantity
         FROM minted m
         LEFT JOIN market k ON k.asset = m.asset AND k.address = m.source
     ), seller_first AS (
       SELECT source, MIN(first_sell_block) AS first_sell_block
         FROM per_minter
        WHERE sell_count > 0
        GROUP BY source
     ), redeploy AS (
       SELECT s.source,
              COUNT(DISTINCT l.asset) AS later_launches,
              SUM(CAST(m.paid_quantity AS INTEGER)) AS later_paid_raw
         FROM seller_first s
         JOIN launch_mints m
           ON m.source = s.source AND m.block_index > s.first_sell_block
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
        GROUP BY s.source
     )
     SELECT p.source AS address,
            COUNT(*) AS minted_launches,
            SUM(CASE WHEN sell_count = 0 THEN 1 ELSE 0 END) AS holding_launches,
            SUM(CASE WHEN buy_count > 0 AND sell_count > 0 THEN 1 ELSE 0 END) AS traded_launches,
            SUM(CASE WHEN launch_block IS NOT NULL
                       AND first_sell_block <= launch_block +
                           (SELECT fast_exit_blocks FROM settings)
                     THEN 1 ELSE 0 END) AS immediate_dump_launches,
            SUM(CASE WHEN launch_block IS NOT NULL
                       AND first_sell_block > launch_block +
                           (SELECT fast_exit_blocks FROM settings)
                     THEN 1 ELSE 0 END) AS later_dump_launches,
            SUM(CASE WHEN sell_count > 0
                       AND (remaining_quantity <= ${EXIT_DUST_RAW}
                            OR remaining_quantity <= acquired_quantity / ${EXIT_DUST_DIVISOR})
                     THEN 1 ELSE 0 END) AS exited_launches,
            SUM(CASE WHEN phase = 'graduated' THEN 1 ELSE 0 END) AS graduated_launches,
            SUM(CASE WHEN phase = 'graduated' AND sell_count = 0
                     THEN 1 ELSE 0 END) AS graduated_no_sale_launches,
            SUM(CASE WHEN sell_count > 0 THEN 1 ELSE 0 END) AS sold_launches,
            SUM(CASE WHEN sell_count > 0
                       AND remaining_quantity > ${EXIT_DUST_RAW}
                       AND remaining_quantity > acquired_quantity / ${EXIT_DUST_DIVISOR}
                     THEN 1 ELSE 0 END) AS seller_remaining_launches,
            CASE WHEN COALESCE(MAX(r.later_launches), 0) > 0 THEN 1 ELSE 0 END
              AS redeployed_after_sale,
            CAST(COALESCE(MAX(r.later_paid_raw), 0) AS TEXT) AS redeployed_paid_raw
       FROM per_minter p
       LEFT JOIN redeploy r ON r.source = p.source
      GROUP BY p.source`,
  );

  // This replaces the address-only orphan read that the rollup already needs,
  // so comparing the full row costs no additional D1 rows: D1 bills rows, not
  // selected column width. It does remove an UPSERT/read for every unchanged
  // wallet below, which is the overwhelmingly common case after the seed.
  const stored = await q<WalletBehaviorRollup>(
    db,
    `SELECT address, minted_launches, holding_launches, traded_launches,
            immediate_dump_launches, later_dump_launches, exited_launches,
            graduated_launches, graduated_no_sale_launches, sold_launches,
            seller_remaining_launches, redeployed_after_sale, redeployed_paid_raw
       FROM behavior_wallets`,
  );
  const storedByAddress = new Map(stored.map((row) => [row.address, row]));
  const changed = wallets.filter((row) =>
    walletChanged(row, storedByAddress.get(row.address)),
  );

  const now = Math.floor(Date.now() / 1000);
  let walletsWritten = 0;
  if (changed.length > 0) {
    const statement = db.prepare(
      `INSERT INTO behavior_wallets (
         address, minted_launches, holding_launches, traded_launches,
         immediate_dump_launches, later_dump_launches, exited_launches,
         graduated_launches, graduated_no_sale_launches, sold_launches,
         seller_remaining_launches, redeployed_after_sale, redeployed_paid_raw,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT(address) DO UPDATE SET
         minted_launches = excluded.minted_launches,
         holding_launches = excluded.holding_launches,
         traded_launches = excluded.traded_launches,
         immediate_dump_launches = excluded.immediate_dump_launches,
         later_dump_launches = excluded.later_dump_launches,
         exited_launches = excluded.exited_launches,
         graduated_launches = excluded.graduated_launches,
         graduated_no_sale_launches = excluded.graduated_no_sale_launches,
         sold_launches = excluded.sold_launches,
         seller_remaining_launches = excluded.seller_remaining_launches,
         redeployed_after_sale = excluded.redeployed_after_sale,
         redeployed_paid_raw = excluded.redeployed_paid_raw,
         updated_at = excluded.updated_at
       WHERE behavior_wallets.minted_launches IS NOT excluded.minted_launches
          OR behavior_wallets.holding_launches IS NOT excluded.holding_launches
          OR behavior_wallets.traded_launches IS NOT excluded.traded_launches
          OR behavior_wallets.immediate_dump_launches IS NOT excluded.immediate_dump_launches
          OR behavior_wallets.later_dump_launches IS NOT excluded.later_dump_launches
          OR behavior_wallets.exited_launches IS NOT excluded.exited_launches
          OR behavior_wallets.graduated_launches IS NOT excluded.graduated_launches
          OR behavior_wallets.graduated_no_sale_launches IS NOT excluded.graduated_no_sale_launches
          OR behavior_wallets.sold_launches IS NOT excluded.sold_launches
          OR behavior_wallets.seller_remaining_launches IS NOT excluded.seller_remaining_launches
          OR behavior_wallets.redeployed_after_sale IS NOT excluded.redeployed_after_sale
          OR behavior_wallets.redeployed_paid_raw IS NOT excluded.redeployed_paid_raw`,
    );
    for (let i = 0; i < changed.length; i += SQL_VAR_LIMIT) {
      const chunk = changed.slice(i, i + SQL_VAR_LIMIT);
      const results = await db.batch(
        chunk.map((row) =>
          statement.bind(
            row.address,
            row.minted_launches,
            row.holding_launches,
            row.traded_launches,
            row.immediate_dump_launches,
            row.later_dump_launches,
            row.exited_launches,
            row.graduated_launches,
            row.graduated_no_sale_launches,
            row.sold_launches,
            row.seller_remaining_launches,
            row.redeployed_after_sale,
            row.redeployed_paid_raw,
            now,
          ),
        ),
      );
      walletsWritten += results.reduce(
        (sum, result) => sum + (result.meta.rows_written ?? 0),
        0,
      );
    }
  }

  // A conformance verdict can remove a wallet's only eligible launch. Delete
  // only actual orphans from the same stored snapshot used for the diff.
  const live = new Set(wallets.map((row) => row.address));
  const orphaned = stored.map((row) => row.address).filter((address) => !live.has(address));
  for (let i = 0; i < orphaned.length; i += SQL_VAR_LIMIT) {
    const chunk = orphaned.slice(i, i + SQL_VAR_LIMIT);
    const places = chunk.map((_, index) => `?${index + 1}`).join(",");
    const result = await db
      .prepare(`DELETE FROM behavior_wallets WHERE address IN (${places})`)
      .bind(...chunk)
      .run();
    walletsWritten += result.meta.rows_written ?? 0;
  }

  const buyers = await db
    .prepare(`SELECT COUNT(*) AS n FROM behavior_buyers`)
    .first<{ n: number }>();
  const totals = {
    minters: wallets.length,
    holding: wallets.filter((row) => row.holding_launches > 0).length,
    trading: wallets.filter((row) => row.traded_launches > 0).length,
    immediate: wallets.filter((row) => row.immediate_dump_launches > 0).length,
    later: wallets.filter((row) => row.later_dump_launches > 0).length,
    graduatedMinters: wallets.filter((row) => row.graduated_launches > 0).length,
    graduatedNeverSold: wallets.filter(
      (row) =>
        row.graduated_launches > 0 &&
        row.graduated_no_sale_launches === row.graduated_launches,
    ).length,
    buyers: buyers?.n ?? 0,
    sellers: wallets.filter((row) => row.sold_launches > 0).length,
    redeployAndHold: wallets.filter(
      (row) => row.redeployed_after_sale > 0 && row.seller_remaining_launches > 0,
    ).length,
    redeployAndExit: wallets.filter(
      (row) => row.redeployed_after_sale > 0 && row.seller_remaining_launches === 0,
    ).length,
    holdWithoutRedeploy: wallets.filter(
      (row) => row.redeployed_after_sale === 0 && row.seller_remaining_launches > 0,
    ).length,
    exitWithoutRedeploy: wallets.filter(
      (row) => row.sold_launches > 0 &&
        row.redeployed_after_sale === 0 && row.seller_remaining_launches === 0,
    ).length,
    redeployedPaidRaw: wallets.reduce(
      (sum, row) => sum + BigInt(row.redeployed_paid_raw),
      0n,
    ).toString(),
  };
  const totalsResult = await db
    .prepare(
      `INSERT INTO behavior_totals (
         id, minter_addresses, mint_and_holding, mint_and_trading,
         immediate_dumpers, later_dumpers, buyers,
         graduated_minter_addresses, graduated_never_sold,
         seller_addresses, redeploy_and_hold, redeploy_and_exit,
         hold_without_redeploy, exit_without_redeploy, redeployed_paid_raw,
         updated_at
       ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT(id) DO UPDATE SET
         minter_addresses = excluded.minter_addresses,
         mint_and_holding = excluded.mint_and_holding,
         mint_and_trading = excluded.mint_and_trading,
         immediate_dumpers = excluded.immediate_dumpers,
         later_dumpers = excluded.later_dumpers,
         buyers = excluded.buyers,
         graduated_minter_addresses = excluded.graduated_minter_addresses,
         graduated_never_sold = excluded.graduated_never_sold,
         seller_addresses = excluded.seller_addresses,
         redeploy_and_hold = excluded.redeploy_and_hold,
         redeploy_and_exit = excluded.redeploy_and_exit,
         hold_without_redeploy = excluded.hold_without_redeploy,
         exit_without_redeploy = excluded.exit_without_redeploy,
         redeployed_paid_raw = excluded.redeployed_paid_raw,
         updated_at = excluded.updated_at
       WHERE behavior_totals.minter_addresses IS NOT excluded.minter_addresses
          OR behavior_totals.mint_and_holding IS NOT excluded.mint_and_holding
          OR behavior_totals.mint_and_trading IS NOT excluded.mint_and_trading
          OR behavior_totals.immediate_dumpers IS NOT excluded.immediate_dumpers
          OR behavior_totals.later_dumpers IS NOT excluded.later_dumpers
          OR behavior_totals.buyers IS NOT excluded.buyers
          OR behavior_totals.graduated_minter_addresses IS NOT excluded.graduated_minter_addresses
          OR behavior_totals.graduated_never_sold IS NOT excluded.graduated_never_sold
          OR behavior_totals.seller_addresses IS NOT excluded.seller_addresses
          OR behavior_totals.redeploy_and_hold IS NOT excluded.redeploy_and_hold
          OR behavior_totals.redeploy_and_exit IS NOT excluded.redeploy_and_exit
          OR behavior_totals.hold_without_redeploy IS NOT excluded.hold_without_redeploy
          OR behavior_totals.exit_without_redeploy IS NOT excluded.exit_without_redeploy
          OR behavior_totals.redeployed_paid_raw IS NOT excluded.redeployed_paid_raw`,
    )
    .bind(
      totals.minters,
      totals.holding,
      totals.trading,
      totals.immediate,
      totals.later,
      totals.buyers,
      totals.graduatedMinters,
      totals.graduatedNeverSold,
      totals.sellers,
      totals.redeployAndHold,
      totals.redeployAndExit,
      totals.holdWithoutRedeploy,
      totals.exitWithoutRedeploy,
      totals.redeployedPaidRaw,
      now,
    )
    .run();

  return {
    wallets_written: walletsWritten,
    totals_written: totalsResult.meta.rows_written ?? 0,
  };
}
