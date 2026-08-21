-- An asset name is NOT unique across fairminters. The owner of an unlocked
-- asset can open a new fairminter under the same ticker — most plainly after
-- a refunded launch — and replay.ts has said so all along ("a ticker can be
-- reused by a later fairminter"). This index asserted otherwise, and the
-- assertion is not the conflict target of the launches upsert
-- (ON CONFLICT(tx_hash)), so the relaunch's INSERT would raise instead of
-- updating: one constraint error aborting the whole db.batch chunk it rode
-- in, taking up to 99 unrelated launches' updates down with it, on every
-- tick, forever.
--
-- The index survives as a plain one — the /<ASSET> lookup it exists for is
-- just as served — and getLaunch now picks its row deterministically
-- (conforming first, then newest) instead of leaning on uniqueness.
DROP INDEX idx_launches_asset;
CREATE INDEX idx_launches_asset ON launches(asset);
