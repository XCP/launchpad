-- The announce-block repair worklist, indexed.
--
-- announce_block used to be written only by resolveUndecided, which a row
-- first seen while pending never reaches: such a row is judged immediately
-- from its own block_index, so `conforming` is already set and the undecided
-- worklist skips it forever. When it later opened, Counterparty rewrote
-- block_index to the opening block and the announcement block was gone —
-- leaving a permanent NULL that sorted as block 0 anywhere age was the
-- measure ("Newest" put the newest launch last).
--
-- The indexer now captures it at insert, so this backfill covers only rows
-- that opened before that fix. It drains to empty and stays there, which is
-- exactly the case a PARTIAL index is for: the index holds only rows still
-- missing the fact, so the steady state is an empty index and an O(1) probe
-- rather than a scan that grows with every launch ever tracked.
--
-- Same shape as idx_launches_undecided (`... WHERE conforming IS NULL`) and
-- idx_launch_mints_fee_pending.
CREATE INDEX idx_launches_announce_pending ON launches(tx_index)
  WHERE announce_block IS NULL;
