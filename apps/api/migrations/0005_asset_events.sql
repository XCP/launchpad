-- Market events for XCP-69 assets, keyed by the address they moved for. This
-- exists so a profile is one indexed read instead of paginating an address's
-- entire Counterparty ledger in the browser (a normal wallet is ~14,000
-- credits and debits, nearly all of it about assets this site doesn't cover).
-- Work here scales with launches we track, not with how busy a stranger's
-- wallet is.
--
-- Append-only and immutable: a confirmed match never changes, so every write
-- is INSERT OR IGNORE and no row is ever swept, deleted, or upserted. The
-- indexer additionally filters candidates against a stored high-water block
-- BEFORE they reach D1 — a conflicting row still bills as touched, so
-- de-duplication cannot be left to OR IGNORE alone.
--
-- Mints are NOT duplicated here; launch_mints already holds them with exact
-- paid/earned amounts, and a refund is derived from the launch's own phase
-- rather than stored twice.

CREATE TABLE asset_events (
  -- `${event}:${address}` — one Counterparty match credits one side and
  -- debits the other, so the event alone is not unique per address.
  id           TEXT    PRIMARY KEY,
  event        TEXT    NOT NULL,
  address      TEXT    NOT NULL,
  asset        TEXT    NOT NULL,
  block_index  INTEGER NOT NULL,
  -- Signed raw integers as TEXT, same discipline as every other quantity
  -- here: token amounts run to 1e16, above what a REAL holds exactly.
  token_delta  TEXT    NOT NULL,
  xcp_delta    TEXT    NOT NULL,
  kind         TEXT    NOT NULL
);

-- Deliberately ONE index. Every index multiplies the cost of every insert,
-- and the per-asset view this table could also serve is already answered by
-- Counterparty directly on the asset page; a second index has to earn its
-- keep before it gets added.
CREATE INDEX idx_asset_events_address ON asset_events(address, block_index DESC);
