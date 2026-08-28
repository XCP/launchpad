import { q } from "#api/db";
import { EXIT_DUST_DIVISOR, EXIT_DUST_RAW } from "#api/behavior-policy";

export interface BehaviorTarget {
  asset: string;
  phase: "graduated" | "minting";
  minters: number;
  earned_quantity: string | null;
  soft_cap: string;
  hard_cap: string;
  pool_xcp_reserve: string | null;
  pool_token_reserve: string | null;
}

export interface LaunchBehaviorRow {
  asset: string;
  tracked_minters: number;
  holding_signal: number;
  minter_traders: number;
  immediate_dumpers: number;
  later_dumpers: number;
  dumpers_exited: number;
  dumpers_remaining: number;
  dumper_overhang: string;
  fast_dumpers_exited: number;
  fast_dumpers_remaining: number;
  fast_dumper_overhang: string;
  known_fast_minters: number;
  known_fast_inventory: string;
  repeat_dump_minters: number;
  repeat_dump_inventory: string;
  held_without_sale: number;
  moved_without_sale: number;
  sellers_holding: number;
  seller_balance_raw: string;
  fast_sellers_holding: number;
  fast_seller_balance_raw: string;
  dispenser_sellers: number;
  buyers: number;
  buyer_only: number;
  bought_xcp: string;
  sold_xcp: string;
}

export interface RepeatFastExitRow {
  address: string;
  minted_launches: number;
  holding_launches: number;
  traded_launches: number;
  immediate_dump_launches: number;
  later_dump_launches: number;
  exited_launches: number;
  graduated_no_sale_launches: number;
}

interface CohortQueryRow {
  minter_addresses: number;
  mint_and_holding: number;
  mint_and_trading: number;
  immediate_dumpers: number;
  later_dumpers: number;
  buyers: number;
  graduated_minter_addresses: number;
  graduated_never_sold: number;
  seller_addresses: number;
  redeploy_and_hold: number;
  redeploy_and_exit: number;
  hold_without_redeploy: number;
  exit_without_redeploy: number;
  redeployed_paid_raw: string;
  fast_exit_blocks: number;
}

export interface BehaviorCohorts {
  minter_addresses: number;
  mint_and_holding: number;
  mint_and_trading: number;
  immediate_dumpers: number;
  later_dumpers: number;
  buyers: number;
  graduated_minter_addresses: number;
  graduated_never_sold: number;
  seller_addresses: number;
  redeploy_and_hold: number;
  redeploy_and_exit: number;
  hold_without_redeploy: number;
  exit_without_redeploy: number;
  redeployed_paid_raw: string;
  fast_exit_blocks: number;
  repeat_fast: RepeatFastExitRow[];
}

/** The two universes the research surface compares, already in the same order
 * as the public launch index: graduated by market cap, minting by progress. */
export async function listBehaviorTargets(db: D1Database): Promise<BehaviorTarget[]> {
  const statement = db.prepare(
    `SELECT asset, phase, minters, earned_quantity, soft_cap, hard_cap,
            pool_xcp_reserve, pool_token_reserve
       FROM launches
      WHERE conforming = 1 AND phase = ?1
      ORDER BY rank_key DESC, tx_index DESC
      LIMIT 10`,
  );
  const [graduated, minting] = await db.batch<BehaviorTarget>([
    statement.bind("graduated"),
    statement.bind("minting"),
  ]);
  return [...graduated.results, ...minting.results];
}

/**
 * Observable behavior for the selected launches.
 *
 * A "holding signal" means no indexed market sale; it is deliberately not a
 * balance claim because a transfer, dispenser, or LP move can happen outside
 * this focused tape. "Remaining" is the positive tracked acquisition balance
 * after mints, buys, and sells, and carries the same limitation.
 */
export function listLaunchBehavior(
  db: D1Database,
  assets: string[],
): Promise<LaunchBehaviorRow[]> {
  if (assets.length === 0) return Promise.resolve([]);
  const places = assets.map((_, i) => `?${i + 1}`).join(", ");
  return q<LaunchBehaviorRow>(
    db,
    `WITH settings AS (
       SELECT fast_exit_blocks FROM behavior_settings WHERE id = 1
     ), minted AS (
       SELECT l.asset, m.source, l.last_mint_block AS launch_block,
              SUM(CAST(m.earn_quantity AS INTEGER)) AS minted_quantity
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx
        WHERE l.conforming = 1 AND l.asset IN (${places})
        GROUP BY l.asset, m.source, l.last_mint_block
     ), market AS (
       SELECT e.asset, e.address,
              SUM(CASE WHEN e.kind = 'buy' AND CAST(e.token_delta AS INTEGER) > 0
                       THEN CAST(e.token_delta AS INTEGER) ELSE 0 END) AS bought_quantity,
              SUM(CASE WHEN e.kind = 'sell' AND CAST(e.token_delta AS INTEGER) < 0
                       THEN -CAST(e.token_delta AS INTEGER) ELSE 0 END) AS sold_quantity,
              SUM(CASE WHEN e.kind = 'buy' THEN 1 ELSE 0 END) AS buy_count,
              SUM(CASE WHEN e.kind = 'sell' THEN 1 ELSE 0 END) AS sell_count,
              MIN(CASE WHEN e.kind = 'sell' THEN e.block_index END) AS first_sell_block,
              SUM(CASE WHEN e.kind = 'buy' AND CAST(e.xcp_delta AS INTEGER) < 0
                       THEN -CAST(e.xcp_delta AS INTEGER) ELSE 0 END) AS bought_xcp,
              SUM(CASE WHEN e.kind = 'sell' AND CAST(e.xcp_delta AS INTEGER) > 0
                       THEN CAST(e.xcp_delta AS INTEGER) ELSE 0 END) AS sold_xcp
         FROM asset_events e
        WHERE e.asset IN (${places})
        GROUP BY e.asset, e.address
     ), per_minter AS (
       SELECT m.asset, m.source, m.launch_block, m.minted_quantity,
              COALESCE(k.bought_quantity, 0) AS bought_quantity,
              COALESCE(k.sold_quantity, 0) AS sold_quantity,
              COALESCE(k.buy_count, 0) AS buy_count,
              COALESCE(k.sell_count, 0) AS sell_count,
              k.first_sell_block,
              COALESCE(w.immediate_dump_launches, 0) AS known_fast_exits,
              CASE WHEN COALESCE(w.immediate_dump_launches, 0) > 1
                   THEN 1 ELSE 0 END AS known_repeat_dump,
              m.minted_quantity + COALESCE(k.bought_quantity, 0) AS acquired_quantity,
              m.minted_quantity + COALESCE(k.bought_quantity, 0) -
                COALESCE(k.sold_quantity, 0) AS remaining_quantity
         FROM minted m
         LEFT JOIN market k ON k.asset = m.asset AND k.address = m.source
         LEFT JOIN behavior_wallets w ON w.address = m.source
     ), minter_stats AS (
       SELECT asset,
              COUNT(*) AS tracked_minters,
              SUM(CASE WHEN sell_count = 0 THEN 1 ELSE 0 END) AS holding_signal,
              SUM(CASE WHEN buy_count > 0 AND sell_count > 0 THEN 1 ELSE 0 END) AS minter_traders,
              SUM(CASE WHEN launch_block IS NOT NULL
                         AND first_sell_block <= launch_block +
                             (SELECT fast_exit_blocks FROM settings)
                       THEN 1 ELSE 0 END) AS immediate_dumpers,
              SUM(CASE WHEN launch_block IS NOT NULL
                         AND first_sell_block > launch_block +
                             (SELECT fast_exit_blocks FROM settings)
                       THEN 1 ELSE 0 END) AS later_dumpers,
              SUM(CASE WHEN sell_count > 0
                         AND (remaining_quantity <= ${EXIT_DUST_RAW}
                              OR remaining_quantity <= acquired_quantity / ${EXIT_DUST_DIVISOR})
                       THEN 1 ELSE 0 END) AS dumpers_exited,
              SUM(CASE WHEN sell_count > 0
                         AND remaining_quantity > ${EXIT_DUST_RAW}
                         AND remaining_quantity > acquired_quantity / ${EXIT_DUST_DIVISOR}
                       THEN 1 ELSE 0 END) AS dumpers_remaining,
              CAST(COALESCE(SUM(CASE WHEN sell_count > 0
                         AND remaining_quantity > ${EXIT_DUST_RAW}
                         AND remaining_quantity > acquired_quantity / ${EXIT_DUST_DIVISOR}
                       THEN remaining_quantity
                       ELSE 0 END), 0) AS TEXT) AS dumper_overhang,
              SUM(CASE WHEN launch_block IS NOT NULL
                         AND first_sell_block <= launch_block +
                             (SELECT fast_exit_blocks FROM settings)
                         AND (remaining_quantity <= ${EXIT_DUST_RAW}
                              OR remaining_quantity <= acquired_quantity / ${EXIT_DUST_DIVISOR})
                       THEN 1 ELSE 0 END) AS fast_dumpers_exited,
              SUM(CASE WHEN launch_block IS NOT NULL
                         AND first_sell_block <= launch_block +
                             (SELECT fast_exit_blocks FROM settings)
                         AND remaining_quantity > ${EXIT_DUST_RAW}
                         AND remaining_quantity > acquired_quantity / ${EXIT_DUST_DIVISOR}
                       THEN 1 ELSE 0 END) AS fast_dumpers_remaining,
              CAST(COALESCE(SUM(CASE WHEN launch_block IS NOT NULL
                         AND first_sell_block <= launch_block +
                             (SELECT fast_exit_blocks FROM settings)
                         AND remaining_quantity > ${EXIT_DUST_RAW}
                         AND remaining_quantity > acquired_quantity / ${EXIT_DUST_DIVISOR}
                       THEN remaining_quantity
                       ELSE 0 END), 0) AS TEXT) AS fast_dumper_overhang,
              SUM(CASE WHEN known_fast_exits > 0 THEN 1 ELSE 0 END) AS known_fast_minters,
              CAST(COALESCE(SUM(CASE WHEN known_fast_exits > 0
                       THEN minted_quantity ELSE 0 END), 0) AS TEXT) AS known_fast_inventory
             ,SUM(CASE WHEN known_repeat_dump > 0 THEN 1 ELSE 0 END) AS repeat_dump_minters
             ,CAST(COALESCE(SUM(CASE WHEN known_repeat_dump > 0
                       THEN minted_quantity ELSE 0 END), 0) AS TEXT) AS repeat_dump_inventory
         FROM per_minter
        GROUP BY asset
     ), buyer_stats AS (
       SELECT k.asset,
              SUM(CASE WHEN k.buy_count > 0 THEN 1 ELSE 0 END) AS buyers,
              SUM(CASE WHEN k.buy_count > 0 AND m.source IS NULL THEN 1 ELSE 0 END) AS buyer_only,
              CAST(SUM(k.bought_xcp) AS TEXT) AS bought_xcp,
              CAST(SUM(k.sold_xcp) AS TEXT) AS sold_xcp
         FROM market k
         LEFT JOIN minted m ON m.asset = k.asset AND m.source = k.address
        GROUP BY k.asset
     )
     SELECT a.asset,
            COALESCE(s.tracked_minters, 0) AS tracked_minters,
            COALESCE(s.holding_signal, 0) AS holding_signal,
            COALESCE(s.minter_traders, 0) AS minter_traders,
            COALESCE(s.immediate_dumpers, 0) AS immediate_dumpers,
            COALESCE(s.later_dumpers, 0) AS later_dumpers,
            COALESCE(s.dumpers_exited, 0) AS dumpers_exited,
            COALESCE(s.dumpers_remaining, 0) AS dumpers_remaining,
            COALESCE(s.dumper_overhang, '0') AS dumper_overhang,
            COALESCE(s.fast_dumpers_exited, 0) AS fast_dumpers_exited,
            COALESCE(s.fast_dumpers_remaining, 0) AS fast_dumpers_remaining,
            COALESCE(s.fast_dumper_overhang, '0') AS fast_dumper_overhang,
            COALESCE(s.known_fast_minters, 0) AS known_fast_minters,
            COALESCE(s.known_fast_inventory, '0') AS known_fast_inventory,
            COALESCE(s.repeat_dump_minters, 0) AS repeat_dump_minters,
            COALESCE(s.repeat_dump_inventory, '0') AS repeat_dump_inventory,
            COALESCE(h.held_without_sale, s.holding_signal, 0) AS held_without_sale,
            COALESCE(h.moved_without_sale, 0) AS moved_without_sale,
            COALESCE(h.sellers_holding, s.dumpers_remaining, 0) AS sellers_holding,
            COALESCE(h.seller_balance_raw, s.dumper_overhang, '0') AS seller_balance_raw,
            COALESCE(h.fast_sellers_holding, s.fast_dumpers_remaining, 0) AS fast_sellers_holding,
            COALESCE(h.fast_seller_balance_raw, s.fast_dumper_overhang, '0') AS fast_seller_balance_raw,
            COALESCE(h.dispenser_sellers, 0) AS dispenser_sellers,
            COALESCE(b.buyers, 0) AS buyers,
            COALESCE(b.buyer_only, 0) AS buyer_only,
            COALESCE(b.bought_xcp, '0') AS bought_xcp,
            COALESCE(b.sold_xcp, '0') AS sold_xcp
       FROM (SELECT DISTINCT asset FROM minted
             UNION SELECT DISTINCT asset FROM market) a
       LEFT JOIN minter_stats s ON s.asset = a.asset
       LEFT JOIN buyer_stats b ON b.asset = a.asset
       LEFT JOIN behavior_launch_balances h ON h.asset = a.asset`,
    ...assets,
  );
}

/** Sitewide address signals from the write-time materialization populated by
 * migration 0026 and refreshed only when indexed history changes. Public
 * reads are one primary-key lookup plus a ten-row indexed leaderboard seek;
 * they never fold the historical mint/trade tables. Counts intentionally
 * overlap rather than forcing an address into one permanent label. */
export async function getBehaviorCohorts(db: D1Database): Promise<BehaviorCohorts> {
  const [totalsResult, leadersResult] = await db.batch<CohortQueryRow & RepeatFastExitRow>([
    db.prepare(
      `SELECT t.minter_addresses, t.mint_and_holding, t.mint_and_trading,
              t.immediate_dumpers, t.later_dumpers, t.buyers,
              t.graduated_minter_addresses, t.graduated_never_sold,
              t.seller_addresses, t.redeploy_and_hold, t.redeploy_and_exit,
              t.hold_without_redeploy, t.exit_without_redeploy,
              t.redeployed_paid_raw,
              s.fast_exit_blocks
         FROM behavior_totals t
         JOIN behavior_settings s ON s.id = t.id
        WHERE t.id = 1`,
    ),
    db.prepare(
      `SELECT address, minted_launches, holding_launches, traded_launches,
              immediate_dump_launches, later_dump_launches, exited_launches,
              graduated_no_sale_launches
         FROM behavior_wallets
        WHERE immediate_dump_launches > 1
        ORDER BY immediate_dump_launches DESC, minted_launches DESC, address
        LIMIT 10`,
    ),
  ]);
  const row = totalsResult.results[0] as CohortQueryRow | undefined;

  if (!row) {
    throw new Error("behavior rollup is not initialized");
  }
  return {
    minter_addresses: row.minter_addresses,
    mint_and_holding: row.mint_and_holding,
    mint_and_trading: row.mint_and_trading,
    immediate_dumpers: row.immediate_dumpers,
    later_dumpers: row.later_dumpers,
    buyers: row.buyers,
    graduated_minter_addresses: row.graduated_minter_addresses,
    graduated_never_sold: row.graduated_never_sold,
    seller_addresses: row.seller_addresses,
    redeploy_and_hold: row.redeploy_and_hold,
    redeploy_and_exit: row.redeploy_and_exit,
    hold_without_redeploy: row.hold_without_redeploy,
    exit_without_redeploy: row.exit_without_redeploy,
    redeployed_paid_raw: row.redeployed_paid_raw,
    fast_exit_blocks: row.fast_exit_blocks,
    repeat_fast: leadersResult.results as RepeatFastExitRow[],
  };
}
