-- The order book, mirrored, so /v2/activity/orders stops fanning out to
-- Counterparty on every edge-cache miss.
--
-- This is the first table here whose rows MUTATE. Launches mutate too, but
-- mints and asset_events are append-only and immutable, which is what let them
-- be written with INSERT OR IGNORE and never thought about again. An order
-- changes twice in its life at most — its remaining quantity falls as it fills,
-- and its status goes terminal — and then never changes again. The indexer is
-- built around exactly that shape: see src/indexer/orders.ts for why a tick
-- that finds nothing new costs one primary-key read per market and no writes
-- at all.
--
-- Quantities are raw satoshi integers as TEXT, same discipline as every other
-- quantity in this database: the standard's hard cap is above 2^53, so nothing
-- here is safe as a SQLite INTEGER.

CREATE TABLE orders (
  -- Identity and the facts that can never change.
  tx_hash         TEXT    PRIMARY KEY,
  tx_index        INTEGER NOT NULL,
  block_index     INTEGER NOT NULL,
  source          TEXT    NOT NULL,
  -- The XCP-69 side. Only TOKEN/XCP pairs are mirrored: XCP is the
  -- denomination every price on this site is quoted in, and a book mixing
  -- denominations is a list of numbers that cannot be compared to each other.
  asset           TEXT    NOT NULL,
  -- From the ORDER's point of view, not a taker's: it is buying the token if
  -- it is offering XCP for it.
  side            TEXT    NOT NULL,
  -- Original size. The order's price is a statement about these two, which is
  -- why they are stored beside the remainders rather than derived from them:
  -- a half-filled order has not changed the price it is asking.
  token_quantity  TEXT    NOT NULL,
  xcp_quantity    TEXT    NOT NULL,
  expire_index    INTEGER NOT NULL,

  -- The only mutable columns, and therefore the only ones the indexer's delta
  -- guard has to compare.
  token_remaining TEXT    NOT NULL,
  xcp_remaining   TEXT    NOT NULL,
  -- open | filled | cancelled | expired. Counterparty has no "partially
  -- filled"; that is an open order whose remaining is below its original, and
  -- the read route derives it rather than storing a second version of a fact
  -- the quantities already carry.
  status          TEXT    NOT NULL,

  updated_at      INTEGER NOT NULL
);

-- The sitewide tape: newest first, with a tiebreak the chain itself agrees
-- with. tx_index is IN the index rather than only in the ORDER BY, because an
-- ORDER BY carrying a term the index does not means a full sort, which is the
-- cost this index exists to avoid.
CREATE INDEX idx_orders_recent ON orders(block_index DESC, tx_index DESC);

-- "Hide filled" — the live book, which is the smaller half of this table and
-- gets smaller as a share of it over time, since terminal orders accumulate
-- forever and open ones do not. Partial, so it stays proportional to what is
-- actually resting rather than to everything that ever rested, and so the
-- filter is satisfied from the index alone.
CREATE INDEX idx_orders_open ON orders(block_index DESC, tx_index DESC)
  WHERE status = 'open';

-- Deliberately NO per-asset index yet. The indexer does not need one: it
-- compares a digest of what Counterparty returned against a stored digest and
-- only touches D1 when they differ, so it never reads this table per market.
-- The asset page's own order book would need one — add it there, with that
-- feature, rather than paying for it on every insert until then.
