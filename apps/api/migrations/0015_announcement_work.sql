-- Pending chain facts for the Telegram feed.
--
-- `announced` remains the durable record of what the queue accepted. This
-- table is the other half of that state: facts the indexer has committed but
-- the queue has not accepted yet. Triggers populate it in the same SQLite
-- transaction as the source row, so a crash can leave either both facts or
-- neither -- never an indexed mint that the announcer has no way to find.
--
-- The old live query reconstructed this set by anti-joining every historical
-- mint and trade against `announced` on every tick. That was correct but grew
-- with all-time history. This table stays proportional to what is waiting and
-- each accepted key is deleted in the same D1 batch that records it in
-- `announced`.
CREATE TABLE announcement_work (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
) WITHOUT ROWID;

-- The trade trigger and live reader group the primary actor's fills by taker
-- transaction. That query used to have no index because no product read
-- needed it; running it from an INSERT trigger without one would turn each new
-- fill into a scan of all historical trades. The partial index charges one
-- extra index entry only for announcement-eligible rows and keeps that work a
-- point/range lookup for the life of the table.
CREATE INDEX idx_asset_events_announce_tx
    ON asset_events(tx_hash, asset)
 WHERE primary_actor = 1 AND tx_hash IS NOT NULL;

-- A launch can first become conforming on INSERT or on a later verdict
-- update. Seed every lifecycle fact already true at that moment. INSERT OR
-- IGNORE is deliberate: phase updates can observe the same edge more than
-- once across retries, while a Telegram fact has one stable identity.
CREATE TRIGGER announcement_launch_insert
AFTER INSERT ON launches
WHEN NEW.conforming = 1
BEGIN
  INSERT OR IGNORE INTO announcement_work (key, at)
  VALUES ('launch:' || NEW.tx_hash, unixepoch());

  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'open:' || NEW.tx_hash, unixepoch()
   WHERE NEW.phase <> 'scheduled';

  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'closed:' || NEW.tx_hash, unixepoch()
   WHERE NEW.phase IN ('graduated', 'refunded');

  -- The indexer inserts a newly discovered launch's mint rows just before its
  -- launch row. Recover those same-transaction facts here; the ordinary mint
  -- trigger covers every later mint once the conforming launch exists.
  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'mint:' || m.tx_hash, unixepoch()
    FROM launch_mints AS m
   WHERE m.launch_tx = NEW.tx_hash
     AND CAST(m.earn_quantity AS INTEGER) >= 1000000000000;
END;

CREATE TRIGGER announcement_launch_conforming
AFTER UPDATE OF conforming ON launches
WHEN NEW.conforming = 1 AND OLD.conforming IS NOT 1
BEGIN
  INSERT OR IGNORE INTO announcement_work (key, at)
  VALUES ('launch:' || NEW.tx_hash, unixepoch());

  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'open:' || NEW.tx_hash, unixepoch()
   WHERE NEW.phase <> 'scheduled';

  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'closed:' || NEW.tx_hash, unixepoch()
   WHERE NEW.phase IN ('graduated', 'refunded');

  -- Mints can have arrived while the verdict was still unresolved. Fold
  -- those into the same transition instead of requiring a historical scan.
  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'mint:' || m.tx_hash, unixepoch()
    FROM launch_mints AS m
   WHERE m.launch_tx = NEW.tx_hash
     AND CAST(m.earn_quantity AS INTEGER) >= 1000000000000;
END;

CREATE TRIGGER announcement_launch_phase
AFTER UPDATE OF phase ON launches
WHEN NEW.conforming = 1 AND OLD.phase IS NOT NEW.phase
BEGIN
  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'open:' || NEW.tx_hash, unixepoch()
   WHERE NEW.phase <> 'scheduled';

  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'closed:' || NEW.tx_hash, unixepoch()
   WHERE NEW.phase IN ('graduated', 'refunded');
END;

-- 10,000 whole divisible tokens is the feed's announce floor:
-- 10,000 * 100,000,000 raw units. Sub-floor mints never become work, so they
-- cannot accumulate as permanently unserviceable outbox rows.
CREATE TRIGGER announcement_mint_insert
AFTER INSERT ON launch_mints
WHEN CAST(NEW.earn_quantity AS INTEGER) >= 1000000000000
 AND EXISTS (
   SELECT 1 FROM launches AS l
    WHERE l.tx_hash = NEW.launch_tx AND l.conforming = 1
 )
BEGIN
  INSERT OR IGNORE INTO announcement_work (key, at)
  VALUES ('mint:' || NEW.tx_hash, unixepoch());
END;

-- A taker transaction can cross several venues. It becomes one Telegram
-- trade once the transaction total reaches the same 10k-token floor. Running
-- the aggregate after each inserted fill means the row that crosses the floor
-- creates the work; later fills keep the same transaction key.
CREATE TRIGGER announcement_trade_insert
AFTER INSERT ON asset_events
WHEN NEW.primary_actor = 1 AND NEW.tx_hash IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO announcement_work (key, at)
  SELECT 'trade-tx:' || NEW.tx_hash || ':' || NEW.asset, unixepoch()
   WHERE (
     SELECT COALESCE(SUM(
       CASE
         WHEN CAST(e.token_delta AS INTEGER) < 0
           THEN -CAST(e.token_delta AS INTEGER)
         ELSE CAST(e.token_delta AS INTEGER)
       END
     ), 0)
       FROM asset_events AS e
      WHERE e.tx_hash = NEW.tx_hash
        AND e.asset = NEW.asset
        AND e.primary_actor = 1
   ) >= 1000000000000;
END;

-- One-time repair/seed for facts that existed before the triggers. Anything
-- already accepted is excluded, so deploying the migration cannot repost
-- history. Anything genuinely missed becomes ordinary pending work and is
-- repaired by the next live tick.
INSERT OR IGNORE INTO announcement_work (key, at)
SELECT 'launch:' || l.tx_hash, unixepoch()
  FROM launches AS l
 WHERE l.conforming = 1
   AND NOT EXISTS (
     SELECT 1 FROM announced AS a WHERE a.key = 'launch:' || l.tx_hash
   );

INSERT OR IGNORE INTO announcement_work (key, at)
SELECT 'open:' || l.tx_hash, unixepoch()
  FROM launches AS l
 WHERE l.conforming = 1 AND l.phase <> 'scheduled'
   AND NOT EXISTS (
     SELECT 1 FROM announced AS a WHERE a.key = 'open:' || l.tx_hash
   );

INSERT OR IGNORE INTO announcement_work (key, at)
SELECT 'closed:' || l.tx_hash, unixepoch()
  FROM launches AS l
 WHERE l.conforming = 1 AND l.phase IN ('graduated', 'refunded')
   AND NOT EXISTS (
     SELECT 1 FROM announced AS a WHERE a.key = 'closed:' || l.tx_hash
   );

INSERT OR IGNORE INTO announcement_work (key, at)
SELECT 'mint:' || m.tx_hash, unixepoch()
  FROM launch_mints AS m
  JOIN launches AS l ON l.tx_hash = m.launch_tx AND l.conforming = 1
 WHERE CAST(m.earn_quantity AS INTEGER) >= 1000000000000
   AND NOT EXISTS (
     SELECT 1 FROM announced AS a WHERE a.key = 'mint:' || m.tx_hash
   );

INSERT OR IGNORE INTO announcement_work (key, at)
SELECT 'trade-tx:' || e.tx_hash || ':' || e.asset, unixepoch()
  FROM asset_events AS e
 WHERE e.primary_actor = 1 AND e.tx_hash IS NOT NULL
 GROUP BY e.tx_hash, e.asset
HAVING SUM(
         CASE
           WHEN CAST(e.token_delta AS INTEGER) < 0
             THEN -CAST(e.token_delta AS INTEGER)
           ELSE CAST(e.token_delta AS INTEGER)
         END
       ) >= 1000000000000
   AND NOT EXISTS (
     SELECT 1 FROM announced AS a
      WHERE a.key = 'trade-tx:' || e.tx_hash || ':' || e.asset
   );
