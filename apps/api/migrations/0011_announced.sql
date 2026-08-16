-- What the channel has already said.
--
-- The announce feed is driven off the indexer, and the indexer is a cron that
-- can retry, overlap a slow tick, or be redeployed mid-run. Every one of those
-- is harmless for D1 — the writes are idempotent — and none of them are
-- harmless for Telegram, where a repeat is not a no-op but a second message
-- someone reads.
--
-- So an event is announced exactly once, and this table is what says so. The
-- claim is the INSERT: `INSERT OR IGNORE` returns rows_written 1 the first
-- time and 0 forever after, which makes "should I announce this" and "record
-- that I did" the same atomic step rather than a check followed by a race.
--
-- Keys are `<kind>:<identity>` and are derived from chain facts, never from a
-- timestamp or a row id:
--   launch:<tx_hash>            the launch was announced
--   open:<tx_hash>              its mint opened
--   closing:<tx_hash>           the five-block warning went out
--   closed:<tx_hash>            it graduated or refunded
--   mint:<tx_hash>              one mint, keyed by its own transaction
--   trade:<event_id>            one match, keyed by Counterparty's event id
--
-- Append-only, like launch_mints and asset_events: nothing here is ever
-- updated or swept, so no write to it can cost more than the row it adds.
CREATE TABLE announced (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);

-- Deliberately NOT seeded with the existing backlog.
--
-- The alternative was to fill this with every launch and mint on file so the
-- first tick after deploy stayed quiet. That would have made the channel's
-- history unrecoverable: the events would be marked said without having been
-- said, and nothing would ever say them.
--
-- Instead the backlog is replayed on purpose, oldest first, by the admin
-- route — which claims each key as it goes. Until that runs the live indexer
-- would announce the backlog itself, so the two are ordered: replay first,
-- announcing second. The indexer stays switched off (no bot token, or the
-- flag below unset) until the replay has claimed the past.
CREATE TABLE announce_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO announce_state (key, value) VALUES ('live', '0');
