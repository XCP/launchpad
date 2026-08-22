-- A reward is programme accounting until it is attached to a real Bitcoin
-- transaction. These tables deliberately keep those two facts separate:
-- batches/mints/payouts can be frozen before broadcast, while the public UI
-- only treats a payout as sent once reward_payouts.reward_tx_hash points at an
-- actual row in reward_transactions.

CREATE TABLE reward_batches (
  id                    TEXT    PRIMARY KEY,
  asset                 TEXT    NOT NULL DEFAULT 'MINTS',
  reward_per_mint       TEXT    NOT NULL,
  first_mint_number     INTEGER NOT NULL,
  cutoff_mint_number    INTEGER NOT NULL UNIQUE,
  cutoff_block          INTEGER NOT NULL,
  cutoff_tx_index       INTEGER NOT NULL,
  cutoff_tx_hash        TEXT    NOT NULL UNIQUE,
  eligible_mints        INTEGER NOT NULL,
  recipient_count       INTEGER NOT NULL,
  total_quantity        TEXT    NOT NULL,
  manifest_sha256       TEXT    NOT NULL UNIQUE,
  status                TEXT    NOT NULL DEFAULT 'frozen'
                                CHECK (status IN ('frozen', 'broadcast', 'confirmed', 'failed')),
  -- Optional valuation snapshot. It records what the distribution meant at
  -- freeze time without turning a volatile estimate into part of entitlement.
  pool_mints_reserve    TEXT,
  pool_xcp_reserve      TEXT,
  liquidation_xcp      TEXT,
  xcp_usd               REAL,
  btc_usd               REAL,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  broadcast_at          INTEGER,
  confirmed_at          INTEGER,
  CHECK (first_mint_number >= 1),
  CHECK (cutoff_mint_number >= first_mint_number),
  CHECK (eligible_mints = cutoff_mint_number - first_mint_number + 1),
  CHECK (recipient_count >= 1)
);

-- The immutable evidence behind a batch. A mint tx can appear here once for
-- the lifetime of the programme, which makes double-paying it impossible even
-- if two batch manifests are prepared independently.
CREATE TABLE reward_batch_mints (
  mint_tx_hash      TEXT    PRIMARY KEY,
  batch_id          TEXT    NOT NULL REFERENCES reward_batches(id),
  source            TEXT    NOT NULL,
  launch_tx         TEXT    NOT NULL,
  block_index       INTEGER NOT NULL,
  tx_index          INTEGER NOT NULL,
  reward_quantity   TEXT    NOT NULL
);
CREATE INDEX idx_reward_batch_mints_batch
  ON reward_batch_mints(batch_id, block_index, tx_index, mint_tx_hash);
CREATE INDEX idx_reward_batch_mints_source
  ON reward_batch_mints(source, batch_id);

-- A batch may need more than one transaction: for example one MPMA for
-- compatible addresses plus individual enhanced sends for address types MPMA
-- cannot encode. Those transactions still belong to one auditable batch.
CREATE TABLE reward_transactions (
  tx_hash            TEXT    PRIMARY KEY,
  batch_id           TEXT    NOT NULL REFERENCES reward_batches(id),
  method              TEXT    NOT NULL CHECK (method IN ('mpma', 'enhanced_send')),
  status              TEXT    NOT NULL DEFAULT 'broadcast'
                              CHECK (status IN ('broadcast', 'confirmed', 'replaced', 'failed')),
  btc_fee_sats        INTEGER,
  recoverable_sats    INTEGER,
  confirmed_block     INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  confirmed_at        INTEGER
);
CREATE INDEX idx_reward_transactions_batch
  ON reward_transactions(batch_id, status);

-- One address-level entitlement per batch. It may be frozen before the send;
-- reward_tx_hash stays NULL then, so no public profile grows a Rewards tab for
-- a promise. Linking the row after broadcast is the visibility boundary.
CREATE TABLE reward_payouts (
  batch_id        TEXT    NOT NULL REFERENCES reward_batches(id),
  address         TEXT    NOT NULL,
  mint_count      INTEGER NOT NULL,
  quantity        TEXT    NOT NULL,
  reward_tx_hash  TEXT    REFERENCES reward_transactions(tx_hash),
  status          TEXT    NOT NULL DEFAULT 'frozen'
                          CHECK (status IN ('frozen', 'broadcast', 'confirmed', 'failed')),
  PRIMARY KEY (batch_id, address),
  CHECK (mint_count >= 1)
);
CREATE INDEX idx_reward_payouts_address
  ON reward_payouts(address, status);
