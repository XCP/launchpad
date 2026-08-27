-- Counterparty match feeds expose tx_index on every fill, but event_index only
-- exists after the indexer performs extra enrichment for a multi-fill
-- transaction. Telegram previously sorted ordinary same-block trades by that
-- usually-zero event_index and then by transaction hash, making a pool's
-- otherwise continuous price path look random.
--
-- Existing rows retain zero: their transaction index was never stored and
-- cannot be reconstructed from local data. They have already been announced;
-- every newly indexed fill carries the real value.
ALTER TABLE asset_events ADD COLUMN tx_index INTEGER NOT NULL DEFAULT 0;

-- The activity tape has the same chronology requirement. Keep its ORDER BY
-- covered exactly so a newest-first page remains a bounded index seek.
DROP INDEX idx_asset_events_recent;
CREATE INDEX idx_asset_events_recent
  ON asset_events(block_index DESC, tx_index DESC, event_index DESC, id DESC)
  WHERE primary_actor = 1;
