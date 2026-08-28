-- Production already has migration 0025. The behavior research schema starts
-- at 0026 so Wrangler's ordered migration ledger can apply it normally.

-- Per-launch behavior groups market rows by asset and address. Without this,
-- each top-20 comparison scans the entire append-only trade tape.
CREATE INDEX idx_asset_events_asset_address
  ON asset_events(asset, address, block_index);

-- One authoritative threshold. SQL rollups read it, and the API sends the
-- same stored value to the browser; no separately hardcoded response value.
CREATE TABLE behavior_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  fast_exit_blocks INTEGER NOT NULL CHECK (fast_exit_blocks >= 0)
);
INSERT INTO behavior_settings (id, fast_exit_blocks) VALUES (1, 6);

-- Materialized sitewide address behavior. The historical mint/trade fold is
-- recomputed only when indexed history changes, never on a public cache miss.
CREATE TABLE behavior_wallets (
  address                 TEXT PRIMARY KEY,
  minted_launches         INTEGER NOT NULL,
  holding_launches        INTEGER NOT NULL,
  traded_launches         INTEGER NOT NULL,
  immediate_dump_launches INTEGER NOT NULL,
  later_dump_launches     INTEGER NOT NULL,
  exited_launches         INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
CREATE INDEX idx_behavior_wallets_fast
  ON behavior_wallets(immediate_dump_launches DESC, minted_launches DESC, address);

-- Buyer membership is append-only, like asset_events. It lets the totals
-- rollup count actual buyers without rescanning every fill a second time.
CREATE TABLE behavior_buyers (
  address TEXT PRIMARY KEY
);
INSERT OR IGNORE INTO behavior_buyers (address)
SELECT DISTINCT address FROM asset_events WHERE kind = 'buy';

-- One-row public summary. Reading the dashboard's sitewide cohorts is a
-- primary-key lookup regardless of how much history accumulates.
CREATE TABLE behavior_totals (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  minter_addresses  INTEGER NOT NULL,
  mint_and_holding  INTEGER NOT NULL,
  mint_and_trading  INTEGER NOT NULL,
  immediate_dumpers INTEGER NOT NULL,
  later_dumpers     INTEGER NOT NULL,
  buyers            INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Seed existing production history once. Fast exits are measured from the
-- graduation block (the final mint that opens the pool), not from a wallet's
-- first mint. An early minter therefore cannot be mislabeled merely because
-- it waited through the sale and sold when the market finally opened.
WITH minted AS (
  SELECT l.asset, m.source, l.last_mint_block AS launch_block,
         SUM(CAST(m.earn_quantity AS INTEGER)) AS minted_quantity
    FROM launch_mints m
    JOIN launches l ON l.tx_hash = m.launch_tx
   WHERE l.conforming = 1
   GROUP BY l.asset, m.source, l.last_mint_block
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
  SELECT m.asset, m.source, m.launch_block, m.minted_quantity,
         COALESCE(k.bought_quantity, 0) AS bought_quantity,
         COALESCE(k.sold_quantity, 0) AS sold_quantity,
         COALESCE(k.buy_count, 0) AS buy_count,
         COALESCE(k.sell_count, 0) AS sell_count,
         k.first_sell_block
    FROM minted m
    LEFT JOIN market k ON k.asset = m.asset AND k.address = m.source
), wallets AS (
  SELECT source AS address,
         COUNT(*) AS minted_launches,
         SUM(CASE WHEN sell_count = 0 THEN 1 ELSE 0 END) AS holding_launches,
         SUM(CASE WHEN buy_count > 0 AND sell_count > 0 THEN 1 ELSE 0 END) AS traded_launches,
         SUM(CASE WHEN launch_block IS NOT NULL
                    AND first_sell_block <= launch_block +
                        (SELECT fast_exit_blocks FROM behavior_settings WHERE id = 1)
                  THEN 1 ELSE 0 END) AS immediate_dump_launches,
         SUM(CASE WHEN launch_block IS NOT NULL
                    AND first_sell_block > launch_block +
                        (SELECT fast_exit_blocks FROM behavior_settings WHERE id = 1)
                  THEN 1 ELSE 0 END) AS later_dump_launches,
         SUM(CASE WHEN sell_count > 0
                    AND minted_quantity + bought_quantity - sold_quantity <= 0
                  THEN 1 ELSE 0 END) AS exited_launches
    FROM per_minter
   GROUP BY source
)
INSERT INTO behavior_wallets (
  address, minted_launches, holding_launches, traded_launches,
  immediate_dump_launches, later_dump_launches, exited_launches, updated_at
)
SELECT address, minted_launches, holding_launches, traded_launches,
       immediate_dump_launches, later_dump_launches, exited_launches, unixepoch()
  FROM wallets;

INSERT INTO behavior_totals (
  id, minter_addresses, mint_and_holding, mint_and_trading,
  immediate_dumpers, later_dumpers, buyers, updated_at
)
SELECT 1,
       COUNT(*),
       COALESCE(SUM(CASE WHEN holding_launches > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(CASE WHEN traded_launches > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(CASE WHEN immediate_dump_launches > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(CASE WHEN later_dump_launches > 0 THEN 1 ELSE 0 END), 0),
       (SELECT COUNT(*) FROM behavior_buyers),
       unixepoch()
  FROM behavior_wallets;
