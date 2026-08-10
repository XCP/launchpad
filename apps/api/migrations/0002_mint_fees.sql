-- Bitcoin-side cost of each mint: what it actually paid to confirm. Looked
-- up once per mint, ever, from the newly-inserted rows only — never
-- re-fetched, so this never grows into a repeat cost as mints accumulate.
-- sat/vB is derived at read time (fee_sats / (weight_wu / 4.0)); storing it
-- pre-divided would just be a second, driftable copy of the same fact.
ALTER TABLE launch_mints ADD COLUMN fee_sats INTEGER;
ALTER TABLE launch_mints ADD COLUMN weight_wu INTEGER;
