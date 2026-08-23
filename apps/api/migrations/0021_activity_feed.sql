-- The sitewide activity tape: "what just happened", newest first, across every
-- launch rather than within one.
--
-- Both tables were indexed only for the questions the site asked before
-- /activity existed — launch-first (idx_launch_mints_launch), minter-first
-- (idx_launch_mints_source), address-first (idx_asset_events_address). A
-- chain-wide tape asks none of those, so without these the newest twenty-five
-- rows cost a full scan plus a sort, and D1 bills every row a scan touches.
-- That is the wrong cost curve for a page whose entire purpose is to be left
-- open and watched.
--
-- The tiebreak columns are load-bearing, not decoration. Several mints land in
-- one block and a whole book fill's rows share one; a pager whose second page
-- depends on whatever order SQLite happened to visit rowids in can repeat or
-- skip a row between two requests. They are IN the index because an ORDER BY
-- with a trailing term the index does not carry forces the sort this index
-- exists to avoid.

CREATE INDEX idx_launch_mints_recent ON launch_mints(block_index DESC, tx_hash DESC);

-- Partial, matching the tape's WHERE exactly. An order match writes one row
-- per side; primary_actor = 0 is the resting maker, kept for portfolio
-- reconstruction and never shown in a tape — printing it would show every
-- book fill twice, once as a buy and once as a sell. Excluding those rows
-- keeps this index smaller than the table and lets the filter be satisfied by
-- the index alone.
CREATE INDEX idx_asset_events_recent
  ON asset_events(block_index DESC, event_index DESC, id DESC)
  WHERE primary_actor = 1;

-- No third index for the launches tape, deliberately. `launches` is bounded by
-- how many launches have ever existed — hundreds — not by how much has
-- happened, so a scan-and-sort of it costs less than what a fourth index would
-- add to every indexer write on the hottest table in this database. Revisit if
-- that table is ever measured in tens of thousands.
