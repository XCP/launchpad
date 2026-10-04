-- Ledger hashes detect reparses; Bitcoin hashes also identify empty-block forks.
ALTER TABLE indexed_blocks ADD COLUMN block_hash TEXT;

-- Snapshot reconciliation seeks one market instead of scanning every order.
CREATE INDEX idx_orders_asset ON orders(asset,tx_hash);
