-- The per-asset trade table pages through the complete indexed tape. Cover
-- both its asset predicate and exact newest-first order so page 200 is still
-- a bounded index walk rather than a sitewide scan plus temporary sort.
CREATE INDEX idx_asset_events_asset_recent
  ON asset_events(asset, block_index DESC, tx_index DESC, event_index DESC, id DESC)
  WHERE primary_actor = 1;
