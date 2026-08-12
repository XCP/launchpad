-- The fee backfill's worklist, indexed.
--
-- `SELECT tx_hash FROM launch_mints WHERE fee_sats IS NULL LIMIT n` runs on
-- every cron tick and, per D1's own insights, was a full SCAN: 276 runs had
-- read 4,748 rows to return zero results, because the backfill has nothing
-- left to do. That cost grows with every mint ever recorded, forever, while
-- the answer stays empty.
--
-- A PARTIAL index fixes it at the root: the index contains only the rows that
-- still need a fee, so the lookup is proportional to work outstanding rather
-- than to table size. A row leaves the index the moment its fee lands, so the
-- steady state is an empty index and an O(1) probe.
--
-- Same shape as idx_launches_undecided (`... WHERE conforming IS NULL`),
-- which solves the identical "small worklist inside a growing table" problem
-- for the conformance verdict.
CREATE INDEX idx_launch_mints_fee_pending ON launch_mints(tx_hash)
  WHERE fee_sats IS NULL;
