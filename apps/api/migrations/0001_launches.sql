-- One row per fairminter the poller has seen, filtered to those whose fixed
-- parameters could conform at all (xcp69Params) — every other row on the
-- chain is display-only elsewhere and never earns a row here. Quantities are
-- raw satoshi integers as TEXT: the standard's hard cap (1e16) is above
-- 2^53, so nothing here is safe as a D1/SQLite INTEGER without truncating.

CREATE TABLE launches (
  -- identity (immutable)
  tx_hash                     TEXT    PRIMARY KEY,
  tx_index                    INTEGER NOT NULL,
  asset                       TEXT    NOT NULL,
  asset_longname               TEXT,
  source                       TEXT    NOT NULL,
  divisible                    INTEGER NOT NULL,

  -- creation facts (immutable; announce_block/original_deadline come from the
  -- append-only NEW_FAIRMINTER event, fetched once per launch — see the
  -- doc comment on fetchOriginalRecord in the web app for why the
  -- /fairminters row itself cannot answer these once a launch has opened)
  announce_block                INTEGER,
  original_deadline             INTEGER,
  start_block                   INTEGER NOT NULL,
  end_block                     INTEGER NOT NULL,
  price                         TEXT    NOT NULL,
  quantity_by_price             TEXT    NOT NULL,
  hard_cap                      TEXT    NOT NULL,
  soft_cap                      TEXT    NOT NULL,
  pool_quantity                 TEXT,
  max_mint_per_tx                TEXT    NOT NULL,
  max_mint_per_address            TEXT,
  premint_quantity               TEXT    NOT NULL,
  minted_asset_commission_int      TEXT,
  burn_payment                   INTEGER NOT NULL,
  lock_quantity                  INTEGER NOT NULL,
  lock_description                INTEGER NOT NULL,
  lp_asset                        TEXT,
  description                     TEXT,

  -- the editorial verdict. NULL = undecided (params match but the creation
  -- event hasn't been fetched yet, or the launch is still unconfirmed).
  -- conformance_version lets a change to the standard's own predicate force
  -- a re-derive of every row instead of grandfathering stale verdicts.
  conforming                      INTEGER,
  conformance_version              INTEGER NOT NULL DEFAULT 1,

  -- progress (mutable — every write here must be delta-guarded, see the
  -- indexer; D1 bills per row touched regardless of whether the value changed)
  status                           TEXT    NOT NULL,
  phase                            TEXT    NOT NULL,
  earned_quantity                  TEXT,
  paid_quantity                    TEXT,
  current_deadline_block            INTEGER NOT NULL,
  mints                             INTEGER NOT NULL DEFAULT 0,
  minters                           INTEGER NOT NULL DEFAULT 0,
  pool_xcp_reserve                  TEXT,
  pool_token_reserve                TEXT,
  pool_xcp_sats                     INTEGER NOT NULL DEFAULT 0,

  seen_at_block                     INTEGER NOT NULL,
  updated_at                        INTEGER NOT NULL
);

-- Index page: listed rows within a phase, newest-announced or deepest-pool first.
CREATE INDEX idx_launches_listed ON launches(conforming, phase, announce_block DESC);
CREATE INDEX idx_launches_depth  ON launches(conforming, phase, pool_xcp_sats DESC);
-- Detail page: /<ASSET> resolves without a scan.
CREATE UNIQUE INDEX idx_launches_asset ON launches(asset);
-- Poller worklist: rows still owing a creation-event lookup. Partial, so it
-- stays tiny — most rows resolve once and drop out of it forever.
CREATE INDEX idx_launches_undecided ON launches(tx_index)
  WHERE conforming IS NULL;

-- One row per fairmint. Append-only — a mint, once seen, never changes, so
-- this table is INSERT OR IGNORE only and never costs a write on a re-poll.
CREATE TABLE launch_mints (
  tx_hash       TEXT    PRIMARY KEY,
  launch_tx     TEXT    NOT NULL,
  block_index   INTEGER NOT NULL,
  source        TEXT    NOT NULL,
  earn_quantity TEXT    NOT NULL,
  paid_quantity TEXT    NOT NULL
);
CREATE INDEX idx_launch_mints_launch ON launch_mints(launch_tx, block_index DESC);
CREATE INDEX idx_launch_mints_minter ON launch_mints(launch_tx, source);

-- Poller cursors and the cron lock. One row per key; every write here is
-- already a single-row upsert by construction.
CREATE TABLE chain_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
