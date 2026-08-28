-- Sale outcomes only make sense for addresses that minted a launch whose
-- market actually opened. Keep this denominator materialized so the public
-- dashboard never scans historical mint/trade rows on a cache miss.
ALTER TABLE behavior_wallets
  ADD COLUMN graduated_launches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_wallets
  ADD COLUMN graduated_no_sale_launches INTEGER NOT NULL DEFAULT 0;

ALTER TABLE behavior_totals
  ADD COLUMN graduated_minter_addresses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE behavior_totals
  ADD COLUMN graduated_never_sold INTEGER NOT NULL DEFAULT 0;

WITH minted AS (
  SELECT l.asset, m.source
    FROM launch_mints m
    JOIN launches l ON l.tx_hash = m.launch_tx
   WHERE l.conforming = 1 AND l.phase = 'graduated'
   GROUP BY l.asset, m.source
), sold AS (
  SELECT asset, address
    FROM asset_events
   WHERE kind = 'sell'
   GROUP BY asset, address
), graduated AS (
  SELECT m.source AS address,
         COUNT(*) AS launches,
         SUM(CASE WHEN s.address IS NULL THEN 1 ELSE 0 END) AS no_sale_launches
    FROM minted m
    LEFT JOIN sold s ON s.asset = m.asset AND s.address = m.source
   GROUP BY m.source
)
UPDATE behavior_wallets AS w
   SET graduated_launches = g.launches,
       graduated_no_sale_launches = g.no_sale_launches
  FROM graduated g
 WHERE g.address = w.address;

UPDATE behavior_totals
   SET graduated_minter_addresses = (
         SELECT COUNT(*) FROM behavior_wallets WHERE graduated_launches > 0
       ),
       graduated_never_sold = (
         SELECT COUNT(*)
           FROM behavior_wallets
          WHERE graduated_launches > 0
            AND graduated_no_sale_launches = graduated_launches
       ),
       updated_at = unixepoch()
 WHERE id = 1;

