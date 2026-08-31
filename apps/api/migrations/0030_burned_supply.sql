-- Confirmed launch-token quantity actually destroyed at Counterparty's
-- canonical unspendable address. Before graduation the protocol parks the
-- planned pool allocation at that address too; the reconciler removes that
-- reservation. This is not the launch's numeric LP asset (LP burns lock
-- liquidity; they do not destroy launch-token supply).
ALTER TABLE launches ADD COLUMN burned_quantity TEXT NOT NULL DEFAULT '0';

-- Graduated cards are ranked by the same market cap they display. Price alone
-- was equivalent while every asset had the same 100M circulating supply; a
-- burn breaks that equivalence, so the indexed rank includes effective supply.
ALTER TABLE launches ADD COLUMN market_cap_rank REAL GENERATED ALWAYS AS (
  CASE
    WHEN phase = 'graduated'
     AND CAST(pool_token_reserve AS REAL) > 0
    THEN MAX(CAST(hard_cap AS REAL) - CAST(burned_quantity AS REAL), 0)
       * CAST(pool_xcp_reserve AS REAL)
       / CAST(pool_token_reserve AS REAL)
    ELSE 0
  END
) VIRTUAL;

CREATE INDEX idx_launches_market_cap
  ON launches(phase, market_cap_rank DESC, tx_index DESC)
  WHERE conforming = 1;
