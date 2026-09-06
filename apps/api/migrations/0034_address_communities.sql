-- Which curated Counterparty collections each minting address created cards in
-- or holds cards of, from the explorer's batch lookup (api.xcp.io). One row per
-- (address, tag, role). Refreshed a few times a day by the indexer, upserted
-- with a delta guard and pruned per batch, so an unchanged answer costs no
-- write. Read by /v2/communities and, through it, the stats page.
CREATE TABLE address_communities (
  address TEXT    NOT NULL,
  tag     TEXT    NOT NULL,
  role    TEXT    NOT NULL CHECK (role IN ('creator', 'holder')),
  cards   INTEGER NOT NULL,
  PRIMARY KEY (address, tag, role)
) WITHOUT ROWID;

CREATE INDEX idx_address_communities_tag ON address_communities(tag, role, address);
