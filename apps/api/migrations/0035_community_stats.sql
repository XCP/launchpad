-- The /v2/communities answer, materialised when address_communities is
-- refreshed (a few times a day). The stats page regenerates every minute
-- through the service binding, which bypasses the edge cache, so answering
-- it live meant four aggregates over the mint table per minute for a number
-- that changes four times a day. Both tables are written with delta guards.
CREATE TABLE community_stats (
  tag         TEXT    PRIMARY KEY,
  creators    INTEGER NOT NULL,
  collectors  INTEGER NOT NULL,
  members     INTEGER NOT NULL,
  top_asset   TEXT,
  top_minters INTEGER,
  top_share   REAL
) WITHOUT ROWID;

CREATE TABLE community_totals (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  minters     INTEGER NOT NULL,
  represented INTEGER NOT NULL,
  creators    INTEGER NOT NULL,
  collectors  INTEGER NOT NULL
);
