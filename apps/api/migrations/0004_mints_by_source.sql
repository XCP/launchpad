-- "What have I minted?" — the profile's activity feed. launch_mints is
-- otherwise only ever read launch-first (idx_launch_mints_minter leads with
-- launch_tx), so an address-first query would scan the whole table.
CREATE INDEX idx_launch_mints_source ON launch_mints(source, block_index DESC);
