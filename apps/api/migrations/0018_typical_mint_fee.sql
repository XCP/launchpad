-- The rewards page compares its per-mint reward with what a mint typically
-- costs on Bitcoin. Store the observed median beside the other write-time
-- mint totals: calculating it on every page view would sort the entire mint
-- table forever, while the answer can only change when a mint fee lands.

ALTER TABLE mint_totals ADD COLUMN fee_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mint_totals ADD COLUMN median_fee_sats INTEGER NOT NULL DEFAULT 0;

UPDATE mint_totals
   SET fee_samples = (
         SELECT COUNT(*)
           FROM launch_mints m
           JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
          WHERE m.fee_sats IS NOT NULL
       ),
       median_fee_sats = COALESCE((
         WITH ranked AS (
           SELECT m.fee_sats,
                  ROW_NUMBER() OVER (ORDER BY m.fee_sats) AS rn,
                  COUNT(*) OVER () AS n
             FROM launch_mints m
             JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
            WHERE m.fee_sats IS NOT NULL
         )
         SELECT CAST(AVG(fee_sats) AS INTEGER)
           FROM ranked
          WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
       ), 0)
 WHERE id = 1;
