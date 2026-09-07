-- The programme account, precomputed per address.
--
-- getRewardAccount derives entitlement from the first 10,000 conforming mint
-- transactions globally, and the address predicate deliberately sits OUTSIDE
-- that eligibility CTE -- applying it first would give every address its own
-- private 10,000-mint programme. Correct, and the reason the read is expensive:
-- the whole eligible set is built and sorted before one address is selected.
--
-- Measured on production D1 over one day: 393 runs, 1,898,413 rows read, 7.33ms
-- average, query efficiency 0.00. About 4,830 rows read to return one row. It
-- was the largest row reader on the database, and it grows with the programme
-- forever while still returning exactly one row.
--
-- This is a ROLLUP, not a source of truth. It is rebuilt from the same SQL by
-- the indexer, only on ticks where mints were ingested or conformance could
-- have moved, and `reward_account_state` records that a build has happened at
-- all. With no state row the read falls back to deriving it live, so an
-- unbuilt or wiped rollup is a performance problem and never a wrong number on
-- a page about what someone is owed.
CREATE TABLE reward_accounts (
  source        TEXT    PRIMARY KEY,
  earned_mints  INTEGER NOT NULL,
  launches      INTEGER NOT NULL,
  paid_quantity TEXT    NOT NULL
);

-- One row, id 1, written at the end of every successful rebuild. Its presence
-- is what licenses the fast path.
CREATE TABLE reward_account_state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  built_at  INTEGER NOT NULL,
  sources   INTEGER NOT NULL
);
