-- Counterparty Core now returns open orders that never expire: expiration = 0
-- and expire_index = NULL. 0022 declared expire_index NOT NULL, so one such
-- order failed its market's whole write batch and left that book stale.
--
-- NULL now means "no expiry". SQLite cannot drop a NOT NULL constraint with
-- ALTER TABLE, so the table is rebuilt: identical to 0022 except for that one
-- column, every row copied as it is, and both of 0022's indexes recreated. No
-- table references orders and no trigger is defined on it, so nothing else
-- has to be carried across.

DROP TABLE IF EXISTS orders_new;

CREATE TABLE orders_new (
  tx_hash         TEXT    PRIMARY KEY,
  tx_index        INTEGER NOT NULL,
  block_index     INTEGER NOT NULL,
  source          TEXT    NOT NULL,
  asset           TEXT    NOT NULL,
  side            TEXT    NOT NULL,
  token_quantity  TEXT    NOT NULL,
  xcp_quantity    TEXT    NOT NULL,
  -- NULL: the order never expires (Core's expiration = 0).
  expire_index    INTEGER,
  token_remaining TEXT    NOT NULL,
  xcp_remaining   TEXT    NOT NULL,
  status          TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL
);

INSERT INTO orders_new
  (tx_hash, tx_index, block_index, source, asset, side,
   token_quantity, xcp_quantity, expire_index,
   token_remaining, xcp_remaining, status, updated_at)
SELECT tx_hash, tx_index, block_index, source, asset, side,
       token_quantity, xcp_quantity, expire_index,
       token_remaining, xcp_remaining, status, updated_at
  FROM orders;

DROP TABLE orders;

ALTER TABLE orders_new RENAME TO orders;

-- Dropped with the old table; recreated exactly as 0022 defined them.
CREATE INDEX idx_orders_recent ON orders(block_index DESC, tx_index DESC);

CREATE INDEX idx_orders_open ON orders(block_index DESC, tx_index DESC)
  WHERE status = 'open';
