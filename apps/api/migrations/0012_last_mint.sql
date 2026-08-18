-- When each launch was last minted, so the homepage can hold one slot for
-- whichever launch minted most recently — a crown that passes from launch to
-- launch rather than a rank that has to be recomputed.
--
-- Derived, never counted. The value is always MAX(block_index) over this
-- launch's mints, and launch_mints is append-only, so this can only ever move
-- forward. That is what makes the maintenance in the indexer safe as a single
-- monotonic UPDATE rather than a recompute: there is no arithmetic to drift,
-- and re-deriving it from source at any time lands on the same answer. Same
-- argument 0010 makes for the mint rollups, for the same reason.
--
-- Block granularity is the honest granularity. Mints in one block are
-- simultaneous as far as the chain is concerned, so there is no tie to break
-- here that would mean anything — Counterparty's fairmints listing carries no
-- ordering within a block that this could appeal to.
ALTER TABLE launches ADD COLUMN last_mint_block INTEGER;

-- Backfilled once, here, rather than left for the indexer to fill in as
-- launches happen to mint again. Without this the crown would sit empty until
-- something minted after deploy, and a launch that has finished minting would
-- never earn one at all.
--
-- The WHERE is not a micro-optimisation: without it this writes a NULL to
-- every launch that has no mints, which is a row touched for no change, and
-- D1 bills rows touched. With it, only launches that have actually been minted
-- are written.
UPDATE launches
   SET last_mint_block = (
         SELECT MAX(m.block_index) FROM launch_mints m WHERE m.launch_tx = launches.tx_hash
       )
 WHERE EXISTS (
         SELECT 1 FROM launch_mints m WHERE m.launch_tx = launches.tx_hash
       );

-- Deliberately NO index on this column.
--
-- The reigning launch is one ORDER BY over the launches that are currently
-- minting, and that is a few dozen rows out of a table in the low hundreds —
-- a scan SQLite finishes without noticing. An index would buy nothing
-- measurable on a table this size and would cost a b-tree write every time
-- this column moves, forever, which is the one thing the indexer is careful
-- not to spend. If launches ever number in the tens of thousands this is worth
-- revisiting; idx_launches_rank in 0009 is the pattern to copy when it is.
