-- Core's consensus hashes for the blocks this index was built against, newest
-- ~day only. Each tick compares the recent window with the node's; a block
-- whose ledger or messages hash changed means Core re-parsed it (an upgrade's
-- rollback, or a reorg), and the index rolls back to the last block that
-- still matches and re-reads from there. See src/indexer/ledger.ts.
CREATE TABLE indexed_blocks (
  block_index   INTEGER PRIMARY KEY,
  ledger_hash   TEXT NOT NULL,
  messages_hash TEXT
);
