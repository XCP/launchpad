-- A graduated token's dollar return needs a fixed dollar baseline. Its mint
-- price is fixed in XCP, but XCP itself moves: comparing TOKEN/XCP now with
-- TOKEN/XCP at mint silently cancels that movement.
--
-- The market launches when the final mint graduates it and opens the pool, so
-- these are stamped once from that block. Existing rows are filled by the
-- bounded launch-price worklist in indexer/sync.ts; future rows are stamped on
-- their first graduated tick. NULL means the historical source has not
-- answered yet and is safe to retry.

ALTER TABLE launches ADD COLUMN launch_time INTEGER;
ALTER TABLE launches ADD COLUMN launch_xcp_usd REAL;
