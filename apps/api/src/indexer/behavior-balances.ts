import { big } from "@launchpad/xcp69/numeric";
import { q } from "#api/db";
import {
  fetchAssetBalances,
  fetchAssetDispensers,
} from "#api/integrations/counterparty";
import { EXIT_DUST_DIVISOR, EXIT_DUST_RAW } from "#api/behavior-policy";

const WORKLIST_LIMIT = 10;
const FETCH_CONCURRENCY = 3;

interface Observation {
  asset: string;
  address: string;
  acquired_raw: string;
  sell_count: number;
  first_sell_block: number | null;
  launch_block: number | null;
  fast_exit_blocks: number;
}

interface BalanceAggregate {
  asset: string;
  held_without_sale: number;
  moved_without_sale: number;
  sellers_holding: number;
  seller_balance_raw: string;
  fast_sellers_holding: number;
  fast_seller_balance_raw: string;
  dispenser_sellers: number;
}

const changed = (a: BalanceAggregate, b: BalanceAggregate | undefined) =>
  !b ||
  a.held_without_sale !== b.held_without_sale ||
  a.moved_without_sale !== b.moved_without_sale ||
  a.sellers_holding !== b.sellers_holding ||
  a.seller_balance_raw !== b.seller_balance_raw ||
  a.fast_sellers_holding !== b.fast_sellers_holding ||
  a.fast_seller_balance_raw !== b.fast_seller_balance_raw ||
  a.dispenser_sellers !== b.dispenser_sellers;

const meaningful = (balance: bigint, acquired: bigint) =>
  balance > BigInt(EXIT_DUST_RAW) &&
  balance > acquired / BigInt(EXIT_DUST_DIVISOR);

/**
 * Refresh the current-balance facts used by the research dashboard.
 *
 * Ten graduated assets is a hard worklist bound. Holder and dispenser pages
 * are fetched once by the five-minute cron, folded to one row per launch, and
 * only changed rows are written. No browser and no public cache miss can fan
 * out to Counterparty or scan holder histories.
 */
export async function syncBehaviorBalances(db: D1Database): Promise<{
  assets_checked: number;
  written: number;
}> {
  const targets = await q<{ asset: string }>(
    db,
    `SELECT asset
       FROM launches
      WHERE conforming = 1 AND phase = 'graduated'
      ORDER BY rank_key DESC, tx_index DESC
      LIMIT ?1`,
    WORKLIST_LIMIT,
  );
  if (targets.length === 0) return { assets_checked: 0, written: 0 };

  const assets = targets.map((row) => row.asset);
  const places = assets.map((_, index) => `?${index + 1}`).join(",");
  const observations = await q<Observation>(
    db,
    `WITH settings AS (
       SELECT fast_exit_blocks FROM behavior_settings WHERE id = 1
     ), minted AS (
       SELECT l.asset, m.source AS address, l.last_mint_block AS launch_block,
              SUM(CAST(m.earn_quantity AS INTEGER)) AS minted_raw
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx
        WHERE l.conforming = 1 AND l.asset IN (${places})
        GROUP BY l.asset, m.source, l.last_mint_block
     ), market AS (
       SELECT asset, address,
              SUM(CASE WHEN kind = 'buy' AND CAST(token_delta AS INTEGER) > 0
                       THEN CAST(token_delta AS INTEGER) ELSE 0 END) AS bought_raw,
              SUM(CASE WHEN kind = 'sell' THEN 1 ELSE 0 END) AS sell_count,
              MIN(CASE WHEN kind = 'sell' THEN block_index END) AS first_sell_block
         FROM asset_events
        WHERE asset IN (${places})
        GROUP BY asset, address
     )
     SELECT m.asset, m.address,
            CAST(m.minted_raw + COALESCE(k.bought_raw, 0) AS TEXT) AS acquired_raw,
            COALESCE(k.sell_count, 0) AS sell_count,
            k.first_sell_block, m.launch_block,
            (SELECT fast_exit_blocks FROM settings) AS fast_exit_blocks
       FROM minted m
       LEFT JOIN market k ON k.asset = m.asset AND k.address = m.address`,
    ...assets,
  );
  const byAsset = new Map<string, Observation[]>();
  for (const row of observations) {
    const list = byAsset.get(row.asset) ?? [];
    list.push(row);
    byAsset.set(row.asset, list);
  }

  const next: BalanceAggregate[] = [];
  for (let i = 0; i < assets.length; i += FETCH_CONCURRENCY) {
    const chunk = assets.slice(i, i + FETCH_CONCURRENCY);
    const resolved = await Promise.all(
      chunk.map(async (asset) => {
        try {
          const [balances, dispensers] = await Promise.all([
            fetchAssetBalances(asset),
            fetchAssetDispensers(asset),
          ]);
          return { asset, balances, dispensers };
        } catch (error) {
          console.warn({ event: "behavior_balance_fetch_failed", asset, error });
          return null;
        }
      }),
    );

    for (const item of resolved) {
      if (!item) continue;
      const balances = new Map<string, bigint>();
      for (const row of item.balances) {
        const address = row.address ?? row.utxo_address ?? null;
        if (!address) continue;
        balances.set(address, (balances.get(address) ?? 0n) + big(row.quantity));
      }

      let heldWithoutSale = 0;
      let movedWithoutSale = 0;
      let sellersHolding = 0;
      let sellerBalance = 0n;
      let fastSellersHolding = 0;
      let fastSellerBalance = 0n;
      const minters = new Set<string>();
      for (const row of byAsset.get(item.asset) ?? []) {
        minters.add(row.address);
        const balance = balances.get(row.address) ?? 0n;
        const hasPosition = meaningful(balance, big(row.acquired_raw));
        if (row.sell_count === 0) {
          if (hasPosition) heldWithoutSale += 1;
          else movedWithoutSale += 1;
          continue;
        }
        if (!hasPosition) continue;
        sellersHolding += 1;
        sellerBalance += balance;
        const fast =
          row.launch_block !== null &&
          row.first_sell_block !== null &&
          row.first_sell_block <= row.launch_block + row.fast_exit_blocks;
        if (fast) {
          fastSellersHolding += 1;
          fastSellerBalance += balance;
        }
      }

      const dispenserSellers = new Set(
        item.dispensers
          .filter((row) => row.dispense_count > 0)
          .flatMap((row) => [row.source, row.origin ?? ""])
          .filter((address) => minters.has(address)),
      ).size;
      next.push({
        asset: item.asset,
        held_without_sale: heldWithoutSale,
        moved_without_sale: movedWithoutSale,
        sellers_holding: sellersHolding,
        seller_balance_raw: sellerBalance.toString(),
        fast_sellers_holding: fastSellersHolding,
        fast_seller_balance_raw: fastSellerBalance.toString(),
        dispenser_sellers: dispenserSellers,
      });
    }
  }

  const stored = await q<BalanceAggregate>(
    db,
    `SELECT asset, held_without_sale, moved_without_sale, sellers_holding,
            seller_balance_raw, fast_sellers_holding,
            fast_seller_balance_raw, dispenser_sellers
       FROM behavior_launch_balances
      WHERE asset IN (${places})`,
    ...assets,
  );
  const storedByAsset = new Map(stored.map((row) => [row.asset, row]));
  const updates = next.filter((row) => changed(row, storedByAsset.get(row.asset)));
  if (updates.length === 0) {
    return { assets_checked: next.length, written: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const statement = db.prepare(
    `INSERT INTO behavior_launch_balances (
       asset, held_without_sale, moved_without_sale, sellers_holding,
       seller_balance_raw, fast_sellers_holding, fast_seller_balance_raw,
       dispenser_sellers, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(asset) DO UPDATE SET
       held_without_sale = excluded.held_without_sale,
       moved_without_sale = excluded.moved_without_sale,
       sellers_holding = excluded.sellers_holding,
       seller_balance_raw = excluded.seller_balance_raw,
       fast_sellers_holding = excluded.fast_sellers_holding,
       fast_seller_balance_raw = excluded.fast_seller_balance_raw,
       dispenser_sellers = excluded.dispenser_sellers,
       updated_at = excluded.updated_at
     WHERE behavior_launch_balances.held_without_sale IS NOT excluded.held_without_sale
        OR behavior_launch_balances.moved_without_sale IS NOT excluded.moved_without_sale
        OR behavior_launch_balances.sellers_holding IS NOT excluded.sellers_holding
        OR behavior_launch_balances.seller_balance_raw IS NOT excluded.seller_balance_raw
        OR behavior_launch_balances.fast_sellers_holding IS NOT excluded.fast_sellers_holding
        OR behavior_launch_balances.fast_seller_balance_raw IS NOT excluded.fast_seller_balance_raw
        OR behavior_launch_balances.dispenser_sellers IS NOT excluded.dispenser_sellers`,
  );
  const results = await db.batch(
    updates.map((row) =>
      statement.bind(
        row.asset,
        row.held_without_sale,
        row.moved_without_sale,
        row.sellers_holding,
        row.seller_balance_raw,
        row.fast_sellers_holding,
        row.fast_seller_balance_raw,
        row.dispenser_sellers,
        now,
      ),
    ),
  );
  return {
    assets_checked: next.length,
    written: results.reduce(
      (sum, result) => sum + (result.meta.rows_written ?? 0),
      0,
    ),
  };
}
