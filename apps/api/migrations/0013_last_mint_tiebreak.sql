-- Breaking a tie inside one block.
--
-- 0012 crowned the launch with the highest last_mint_block and left ties to
-- fall through to the launch's own tx_index — when the FAIRMINTER was created,
-- which has nothing to do with which mint landed last. With ~40 launches open
-- and a block every ten minutes, two of them taking a mint in the same block
-- happens a few times a day, and the crown was decided by an accident of
-- creation order every time.
--
-- 0012 also claimed the data could not do better: that mints in one block are
-- simultaneous and Counterparty's fairmints listing "carries no ordering
-- within a block that this could appeal to". That was wrong. Every fairmint
-- row carries tx_index, the same global counter the fairminters listing uses,
-- and it orders mints inside a block exactly as it orders them across blocks.
--
-- The tiebreak is COUNT FIRST, then that index:
--
--   ORDER BY last_mint_block DESC, last_mint_count DESC, last_mint_tx_index DESC
--
-- Count first because ordering within a block is miner ordering. If one launch
-- takes five mints in a block and another takes one, and the single mint
-- happens to be sequenced last, the launch nobody piled into would take the
-- crown on a coin flip. Five people arriving is the stronger claim on a slot
-- that exists to show where the activity is. tx_index still settles it when
-- the counts are equal, which is the common case — and both only ever apply
-- WITHIN one block, so recency across blocks is untouched.

-- Ordering for mints inside a block. Nullable because it cannot be
-- backfilled: launch_mints has never stored it, and recovering it would mean
-- re-fetching every mint of every launch from Counterparty to answer a
-- tiebreak on blocks that are already settled. Historical rows sort last among
-- a tie, which leaves those few ties exactly as arbitrary as they are today
-- and makes every future one correct.
ALTER TABLE launch_mints ADD COLUMN tx_index INTEGER;

-- The two halves of the tiebreak, denormalised onto the launch so the crown
-- stays one ORDER BY over the launches table rather than a join to the mints.
ALTER TABLE launches ADD COLUMN last_mint_count INTEGER;
ALTER TABLE launches ADD COLUMN last_mint_tx_index INTEGER;

-- last_mint_count IS backfillable — it only needs block_index, which every
-- mint row already has. Restricted to launches that actually hold a crown, so
-- this does not write a value to every launch that has never minted; D1 bills
-- rows a statement touches, changed or not.
UPDATE launches
   SET last_mint_count = (
         SELECT COUNT(*)
           FROM launch_mints m
          WHERE m.launch_tx = launches.tx_hash
            AND m.block_index = launches.last_mint_block
       )
 WHERE last_mint_block IS NOT NULL;

-- Still no index, for the reason 0012 gives: this is one ordered pass over the
-- few dozen rows currently minting, and an index would cost a write every time
-- any of these three columns moves, forever.
