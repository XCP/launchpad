-- OHLCV per asset, so a price chart reads one indexed range instead of
-- re-paginating Counterparty's match feeds on every page view. Counterparty
-- has no candle endpoint — anyone showing candles builds them, and
-- xcp-explorer already does exactly this for XCP/BTC.
--
-- Prices are stored as XCP SATS PER WHOLE TOKEN, an integer: a price here is
-- a ratio far below 1 XCP (a 690 XCP raise against 100,000,000 supply), and
-- storing ratios as floats is how a chart quietly stops matching the trades
-- it claims to plot. Scaling by 1e8 keeps them exact integers in TEXT, the
-- same discipline every other quantity in this database follows.
--
-- Write shape: a bucket is upserted only while it can still change, and the
-- upsert is delta-guarded, so a tick where nothing traded touches no rows.
-- Buckets older than the newest one are never revisited in practice, because
-- the indexer only ever reads fills newer than its stored cursor.

CREATE TABLE price_candles (
  -- `${asset}:${resolution}:${bucket_start}`
  id           TEXT    PRIMARY KEY,
  asset        TEXT    NOT NULL,
  resolution   TEXT    NOT NULL,
  -- Unix seconds, floored to the resolution.
  bucket_start INTEGER NOT NULL,
  open         TEXT    NOT NULL,
  high         TEXT    NOT NULL,
  low          TEXT    NOT NULL,
  close        TEXT    NOT NULL,
  -- Raw XCP satoshi that changed hands in the bucket.
  volume_xcp   TEXT    NOT NULL,
  trades       INTEGER NOT NULL,
  -- Highest block already folded into this bucket. A tick only ever sees the
  -- fills newer than its cursor, so a bucket has to be merged into rather than
  -- rebuilt — and merging is only safe if it can tell which fills it has
  -- already counted. Block granularity is enough: the fetch takes whole
  -- blocks, so a block is either entirely folded or entirely new.
  last_block   INTEGER NOT NULL
);

-- One index, matching the only question asked of this table: give me a
-- series for one asset at one resolution, newest first. Every index
-- multiplies the cost of every insert, so a second one has to earn its place.
CREATE INDEX idx_price_candles_series
  ON price_candles(asset, resolution, bucket_start DESC);
