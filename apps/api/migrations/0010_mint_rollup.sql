-- /v2/stats, moved from read time to write time.
--
-- Its three aggregates were 27% of every row this database reads — ~500 rows
-- per request, ~300 requests a day — and unlike the index page's ranking there
-- was no index to fix them with: COUNT(DISTINCT) and a GROUP BY on a computed
-- bucket each need a temp b-tree, so the plan was already optimal and the cost
-- simply grew with launch_mints forever.
--
--   SEARCH l USING INDEX idx_launches_listed (conforming=?)
--   SEARCH m USING INDEX idx_launch_mints_launch (launch_tx=? AND block_index>?)
--   USE TEMP B-TREE FOR GROUP BY
--   USE TEMP B-TREE FOR count(DISTINCT)
--
-- What makes materialising worth it is not the read count but the WRITE count.
-- The answer can only change when a mint is ingested, a fee lands, or a
-- conformance verdict flips — and every observed tick reports mints_ingested:
-- 0. So this is recomputed a handful of times a day against ~300 reads that
-- become a single-row lookup, rather than the once-per-tick recompute that
-- would have made it a wash.
--
-- The recompute runs the SAME aggregate query and stores its result. It does
-- not keep running counters and add to them. That is the whole safety
-- argument: there is no incremental arithmetic here, so there is no way for
-- this to drift from the mints it summarises — a recompute always lands on the
-- same answer a live query would have given. Re-deriving a small table is
-- cheap; reconciling a wrong counter is not.

-- Site-wide totals. Exactly one row, ever — the CHECK is what says so, rather
-- than a comment hoping for it.
CREATE TABLE mint_totals (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  mints     INTEGER NOT NULL,
  minters   INTEGER NOT NULL,
  -- XCP satoshi paid into every conforming launch, ever. INTEGER rather than
  -- the TEXT the rest of this schema uses for quantities, because this one
  -- cannot approach 2^53: XCP's entire supply is ~2.6e14 satoshi, two orders
  -- below the limit, and the API has always sent it as a number.
  paid_xcp  INTEGER NOT NULL,
  fee_sats  INTEGER NOT NULL,
  -- When these values last CHANGED, not when the rollup last ran — a recompute
  -- that finds nothing new is delta-guarded and writes no row at all.
  updated_at INTEGER NOT NULL
);

-- Mints per ~day of chain, 144 blocks to the bucket.
--
-- Every bucket is stored, not just the 28 the chart shows. The window slides
-- with block height, so a stored window would go stale every block for a
-- reason that has nothing to do with the data; storing all of them and letting
-- the route slice means the rollup only changes when mints do. There is one
-- row per active day, so the whole table stays smaller than a single one of
-- the scans it replaces.
CREATE TABLE mint_buckets (
  bucket  INTEGER PRIMARY KEY,
  n       INTEGER NOT NULL,
  minters INTEGER NOT NULL
);

-- Filled here rather than left for the first cron tick. Without this /v2/stats
-- would answer zero for up to five minutes after deploy — a wrong answer, not
-- a slow one, and served with a 300s cache in front of it.
INSERT INTO mint_totals (id, mints, minters, paid_xcp, fee_sats, updated_at)
SELECT 1,
       COUNT(*),
       COUNT(DISTINCT m.source),
       CAST(COALESCE(SUM(CAST(m.paid_quantity AS INTEGER)), 0) AS INTEGER),
       CAST(COALESCE(SUM(m.fee_sats), 0) AS INTEGER),
       0
  FROM launch_mints m
  JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1;

INSERT INTO mint_buckets (bucket, n, minters)
SELECT m.block_index / 144,
       COUNT(*),
       COUNT(DISTINCT m.source)
  FROM launch_mints m
  JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
 GROUP BY m.block_index / 144;
