-- Confirmed XCP-69 sends to Counterparty's canonical unspendable address.
--
-- The five-minute Telegram monitor already sees these events. Persisting the
-- same bounded delta lets /activity answer locally instead of polling the
-- Counterparty address feed once per visitor. Burns are rare, so the extra
-- write is event-proportional rather than cron-proportional.
CREATE TABLE token_burns (
  key         TEXT PRIMARY KEY,
  tx_hash     TEXT NOT NULL,
  tx_index    INTEGER NOT NULL,
  msg_index   INTEGER NOT NULL,
  block_index INTEGER NOT NULL,
  source      TEXT NOT NULL,
  destination TEXT NOT NULL,
  asset       TEXT NOT NULL,
  quantity    TEXT NOT NULL
);

-- Exact order used by the sitewide Burns tape. A stable final key keeps
-- paging deterministic even if one transaction burns several assets.
CREATE INDEX idx_token_burns_recent
  ON token_burns(block_index DESC, tx_index DESC, msg_index DESC, key DESC);

-- The tab label should remain a one-row read as history grows.
CREATE TABLE burn_totals (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  burns INTEGER NOT NULL
);
INSERT INTO burn_totals (id, burns) VALUES (1, 0);

CREATE TRIGGER token_burns_count_insert
AFTER INSERT ON token_burns
BEGIN
  UPDATE burn_totals SET burns = burns + 1 WHERE id = 1;
END;
