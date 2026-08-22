-- Creator prose mirrored from xcp.fun metadata. NULL means the bounded
-- indexer worklist has not checked it yet; an empty string means it checked
-- and there was no safe prose to show. Keeping those states distinct makes
-- the backfill drain instead of re-fetching blank or third-party metadata on
-- every five-minute tick.
ALTER TABLE launches ADD COLUMN display_description TEXT;

CREATE INDEX idx_launches_description_work
  ON launches(tx_index)
  WHERE display_description IS NULL;
