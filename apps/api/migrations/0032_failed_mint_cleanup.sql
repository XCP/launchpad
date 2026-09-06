-- A fairminter that misses its soft cap emits an ASSET_DESTRUCTION tagged
-- "soft cap not reached". It reuses the fairminter's tx hash/index and is
-- protocol cleanup for the already-announced refund, not a holder burn.
-- Remove any such rows indexed before that distinction was made.
DELETE FROM token_burns
 WHERE key LIKE 'destroy:%'
   AND EXISTS (
     SELECT 1
       FROM launches
      WHERE launches.phase = 'refunded'
        AND launches.asset = token_burns.asset
        AND launches.tx_index = token_burns.tx_index
   );

-- token_burns has an insert counter because this history is normally
-- append-only. Re-derive it after this one-time correction.
UPDATE burn_totals
   SET burns = (SELECT COUNT(*) FROM token_burns)
 WHERE id = 1;
