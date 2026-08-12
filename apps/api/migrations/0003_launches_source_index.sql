-- "My launches" (source == the connected wallet's own address): every other
-- index on this table is keyed by conforming/phase for the public listing,
-- so a per-address lookup would otherwise be a full table scan.
CREATE INDEX idx_launches_source ON launches(source, announce_block DESC);
