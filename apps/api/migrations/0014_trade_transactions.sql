-- A single order can cross the pool, the book, and then the pool again. The
-- original table knew only a match identity, so two pool matches produced by
-- the same transaction/address/asset shared a primary key and the latter was
-- silently discarded. These columns preserve both the causal transaction and
-- the canonical event order while keeping the table append-only.
ALTER TABLE asset_events ADD COLUMN tx_hash TEXT;
ALTER TABLE asset_events ADD COLUMN event_index INTEGER;
ALTER TABLE asset_events ADD COLUMN primary_actor INTEGER NOT NULL DEFAULT 1;

-- Existing pool events are a tx hash. Existing order events are
-- `<maker hash>_<taker hash>`; the taker (tx1) is the transaction that caused
-- the fill and therefore the transaction Telegram should summarize.
UPDATE asset_events
   SET tx_hash = CASE
     WHEN length(event) = 64 THEN event
     WHEN length(event) = 129 AND substr(event, 65, 1) = '_'
       THEN substr(event, 66, 64)
     ELSE NULL
   END;

-- Order matches have two profile rows. They were inserted tx1 first and tx0
-- second; only tx1 is the actor a buy-bot should announce. The maker's row is
-- still retained for portfolio/history reconstruction.
UPDATE asset_events AS e
   SET primary_actor = CASE
     WHEN length(e.event) = 129 AND substr(e.event, 65, 1) = '_'
       THEN CASE WHEN e.rowid = (
         SELECT MIN(other.rowid) FROM asset_events AS other
          WHERE other.event = e.event AND other.asset = e.asset
       ) THEN 1 ELSE 0 END
     ELSE 1
   END;

-- The announcement identity is changing from one match to one taker
-- transaction. Seed the new identity wherever any constituent fill was
-- already announced, so deploying this migration cannot repost old trades.
INSERT OR IGNORE INTO announced (key, at)
SELECT 'trade-tx:' || e.tx_hash || ':' || e.asset, MIN(a.at)
  FROM asset_events AS e
  JOIN announced AS a ON a.key = 'trade:' || e.event
 WHERE e.tx_hash IS NOT NULL AND e.primary_actor = 1
 GROUP BY e.tx_hash, e.asset;

-- CAPTAINDAN is the transaction that exposed the collision. Re-reading this
-- young asset once is bounded and lets the new event-index identity recover
-- its second pool fill; the legacy first fill keeps its old primary key.
DELETE FROM chain_state WHERE key = 'events_hw:CAPTAINDAN';
