-- Seller outcomes are materialized once when history changes. Public reads
-- stay fixed-cost as the mint and trade tables grow.
ALTER TABLE behavior_wallets ADD COLUMN sold_launches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_wallets ADD COLUMN seller_remaining_launches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_wallets ADD COLUMN redeployed_after_sale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_wallets ADD COLUMN redeployed_paid_raw TEXT NOT NULL DEFAULT '0';

ALTER TABLE behavior_totals ADD COLUMN seller_addresses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_totals ADD COLUMN redeploy_and_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_totals ADD COLUMN redeploy_and_exit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_totals ADD COLUMN hold_without_redeploy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_totals ADD COLUMN exit_without_redeploy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_totals ADD COLUMN redeployed_paid_raw TEXT NOT NULL DEFAULT '0';

-- Current Counterparty balances for the small graduated-launch worklist are
-- folded into one row per launch by the cron. The dashboard never downloads
-- holder lists itself.
CREATE TABLE behavior_launch_balances (
  asset                 TEXT PRIMARY KEY,
  held_without_sale     INTEGER NOT NULL,
  moved_without_sale    INTEGER NOT NULL,
  sellers_holding       INTEGER NOT NULL,
  seller_balance_raw    TEXT NOT NULL,
  fast_sellers_holding  INTEGER NOT NULL,
  fast_seller_balance_raw TEXT NOT NULL,
  dispenser_sellers     INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

WITH minted AS (
  SELECT l.asset, m.source, l.phase,
         SUM(CAST(m.earn_quantity AS INTEGER)) AS minted_quantity
    FROM launch_mints m
    JOIN launches l ON l.tx_hash = m.launch_tx
   WHERE l.conforming = 1
   GROUP BY l.asset, m.source, l.phase
), market AS (
  SELECT asset, address,
         SUM(CASE WHEN kind = 'buy' AND CAST(token_delta AS INTEGER) > 0
                  THEN CAST(token_delta AS INTEGER) ELSE 0 END) AS bought_quantity,
         SUM(CASE WHEN kind = 'sell' AND CAST(token_delta AS INTEGER) < 0
                  THEN -CAST(token_delta AS INTEGER) ELSE 0 END) AS sold_quantity,
         SUM(CASE WHEN kind = 'sell' THEN 1 ELSE 0 END) AS sell_count,
         MIN(CASE WHEN kind = 'sell' THEN block_index END) AS first_sell_block
    FROM asset_events
   GROUP BY asset, address
), per_minter AS (
  SELECT m.asset, m.source, m.phase, m.minted_quantity,
         COALESCE(k.bought_quantity, 0) AS bought_quantity,
         COALESCE(k.sold_quantity, 0) AS sold_quantity,
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
), wallets AS (
  SELECT p.source AS address,
         SUM(CASE WHEN p.sell_count > 0 THEN 1 ELSE 0 END) AS sold_launches,
         SUM(CASE WHEN p.sell_count > 0
                    AND p.remaining_quantity > 100000000
                    AND p.remaining_quantity > p.acquired_quantity / 100
                  THEN 1 ELSE 0 END) AS seller_remaining_launches,
         CASE WHEN COALESCE(MAX(r.later_launches), 0) > 0 THEN 1 ELSE 0 END
           AS redeployed_after_sale,
         CAST(COALESCE(MAX(r.later_paid_raw), 0) AS TEXT) AS redeployed_paid_raw
    FROM per_minter p
    LEFT JOIN redeploy r ON r.source = p.source
   GROUP BY p.source
)
UPDATE behavior_wallets AS b
   SET sold_launches = w.sold_launches,
       seller_remaining_launches = w.seller_remaining_launches,
       redeployed_after_sale = w.redeployed_after_sale,
       redeployed_paid_raw = w.redeployed_paid_raw
  FROM wallets w
 WHERE w.address = b.address;

UPDATE behavior_totals
   SET seller_addresses = (
         SELECT COUNT(*) FROM behavior_wallets WHERE sold_launches > 0
       ),
       redeploy_and_hold = (
         SELECT COUNT(*) FROM behavior_wallets
          WHERE redeployed_after_sale > 0 AND seller_remaining_launches > 0
       ),
       redeploy_and_exit = (
         SELECT COUNT(*) FROM behavior_wallets
          WHERE redeployed_after_sale > 0 AND seller_remaining_launches = 0
       ),
       hold_without_redeploy = (
         SELECT COUNT(*) FROM behavior_wallets
          WHERE redeployed_after_sale = 0 AND seller_remaining_launches > 0
       ),
       exit_without_redeploy = (
         SELECT COUNT(*) FROM behavior_wallets
          WHERE sold_launches > 0 AND redeployed_after_sale = 0
            AND seller_remaining_launches = 0
       ),
       redeployed_paid_raw = (
         SELECT CAST(COALESCE(SUM(CAST(redeployed_paid_raw AS INTEGER)), 0) AS TEXT)
           FROM behavior_wallets
       ),
       updated_at = unixepoch()
 WHERE id = 1;
