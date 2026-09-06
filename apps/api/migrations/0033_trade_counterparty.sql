-- A book fill has two parties, and the trade tape shows it as one row from the
-- taker's side. Record the other party on each row of a fill so a viewer's
-- resting orders can be recognised in the tape without a per-page self-join
-- on the unindexed event key. Pool fills have no counterparty and stay NULL.
ALTER TABLE asset_events ADD COLUMN counterparty_address TEXT;

-- Backfill existing book fills from their sibling rows: same event and asset,
-- the other address. The temporary index turns this into one indexed pass
-- instead of a scan per row, and is dropped again so inserts pay nothing new.
CREATE INDEX idx_asset_events_backfill_pair ON asset_events(event, asset, address);

UPDATE asset_events
   SET counterparty_address = (
     SELECT m.address
       FROM asset_events m
      WHERE m.event = asset_events.event
        AND m.asset = asset_events.asset
        AND m.address <> asset_events.address
      LIMIT 1
   )
 WHERE counterparty_address IS NULL
   AND EXISTS (
     SELECT 1
       FROM asset_events m
      WHERE m.event = asset_events.event
        AND m.asset = asset_events.asset
        AND m.address <> asset_events.address
   );

DROP INDEX idx_asset_events_backfill_pair;
