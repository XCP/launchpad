-- The index page's ranking, moved from a sort into an index.
--
-- listLaunches ranked with a window function — ROW_NUMBER() OVER (PARTITION BY
-- phase ORDER BY <computed expression>) — and per D1's own insights that made
-- it 66% of every row this database reads: 457,523 rows in 24 hours, 204 rows
-- per call from a 44-row table, to return about 36. The plan says why:
--
--   SEARCH launches USING INDEX idx_launches_depth (conforming=?)
--   USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
--   SCAN (subquery-3)
--   SCAN ranked
--
-- The rank is arithmetic on other columns, so no index could serve that ORDER
-- BY; SQLite had to materialise every conforming row and push it through a
-- sorter, and D1 bills the rows going through it. Three passes over the table
-- is where 4.6x-the-table comes from, and it is a multiplier on the table's
-- size, so it gets worse as the site grows rather than staying a fixed cost.
--
-- A GENERATED column is what makes the rank indexable. VIRTUAL, so it costs
-- nothing in the row itself — it is computed on read and materialised only
-- inside the index. Crucially it is not a second copy of the rule that could
-- drift from the first: SQLite derives it from the same row the indexer wrote,
-- so there is no write path to get wrong and nothing to backfill. This is the
-- ONLY definition of the ranking now; the query no longer restates it.
--
-- The rank each phase is judged by, unchanged from what listLaunches computed:
--
--  - graduated: MARKET CAP. Every XCP-69 token has the same fixed supply, so
--    ordering by price and ordering by market cap are the same ordering — and
--    price is the pool's own ratio. NOT pool depth, which was the older key:
--    two pools holding equal XCP can be priced very differently, so depth
--    ranked the biggest pool rather than the most valuable token.
--  - minting: PROGRESS toward the soft cap, fullest first — the launches
--    closest to actually happening.
--  - scheduled (and refunded): START BLOCK, latest first.
--
-- REAL division is fine here and only here: this is a ranking, never a
-- displayed or transacted amount.
ALTER TABLE launches ADD COLUMN rank_key REAL GENERATED ALWAYS AS (
  CASE phase
    WHEN 'graduated' THEN
      CASE WHEN CAST(pool_token_reserve AS REAL) > 0
           THEN CAST(pool_xcp_reserve AS REAL) / CAST(pool_token_reserve AS REAL)
           ELSE 0 END
    WHEN 'minting' THEN
      CASE WHEN CAST(soft_cap AS REAL) > 0
           THEN CAST(earned_quantity AS REAL) / CAST(soft_cap AS REAL)
           ELSE 0 END
    ELSE start_block
  END
) VIRTUAL;

-- Phase first, because the page asks one phase at a time; then the rank, then
-- tx_index to break ties so two launches that round to the same key cannot
-- swap places between two renders of the same data.
--
-- PARTIAL on conforming = 1: that is the only way this table is ever listed,
-- and it keeps the non-conforming rows out of the index entirely rather than
-- carrying them for a query that always excludes them.
--
-- The plan this produces is a single seek that stops at the LIMIT:
--   SEARCH launches USING INDEX idx_launches_rank (phase=?)
-- No temp b-tree, no scan of the rest of the table.
CREATE INDEX idx_launches_rank ON launches(phase, rank_key DESC, tx_index DESC)
  WHERE conforming = 1;

-- idx_launches_depth(conforming, phase, pool_xcp_sats DESC) ordered the index
-- page by pool depth, which stopped being the ranking when market cap replaced
-- it. What kept it alive was the window function above picking it up as the
-- cheapest way to find conforming rows at all — an accident of the plan, not a
-- use of what it was sorted by. With that query gone the only reader left is
-- countByPhase, which needs nothing past its first two columns and takes
-- idx_launches_listed as a covering index instead:
--   SEARCH launches USING COVERING INDEX idx_launches_listed (conforming=?)
-- Dropping it removes an index from every write to this table, and its sort
-- column (pool_xcp_sats) is one that actually moves, so it was being
-- maintained on every pool change for nobody.
DROP INDEX idx_launches_depth;
