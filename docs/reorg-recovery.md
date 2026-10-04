# Reorg and reparse recovery

Every indexer Counterparty read now uses a fresh URL, including retries and fixed
continuation cursors. Core reads the first scalar `verbose` value; a second UUID
value changes its URL cache key without changing enrichment or pagination. Live
room Core reads use the same helper. This addresses Core's retained response
cache, not an untrustworthy provider; the configured node remains the authority.

Migration `0041_reorg_block_identity.sql` adds Bitcoin block hashes to the existing
ledger/messages hash checkpoints. Empty-block Bitcoin forks and Core reparses
are both checked. The last retained checkpoint is explicitly revisited after
downtime, even when the recent 12-block probe has moved beyond it. Missing
verification or no proven common ancestor stops indexing instead of guessing.
Checkpoint history is retained for 144 blocks. Apply the migration before code.

Each index pass records a durable pending height and checks its starting and
ending tip identity. A failure or mid-pass chain change leaves that marker for
repair on restart. Rollback marks derived-state recovery pending in the same
transaction as deletion; replacement hashes alone cannot acknowledge unfinished
rollups. Failed verification pauses downstream scheduled announcements and books.
A verified partial feed can still report its committed progress, while pending
recovery is retained until all required reads and rollups finish.

Existing recovery removes orphan mints, trades, candles, buyers and burns. It now
also catches trade rows committed before their cursor, clears order digests,
removes orphan order inclusions, permits height to decrease, and rechecks formerly
closed/refunded launches. Same-total replacement mints continue to trigger a
rescan. Already-sent announcements and reward batches remain off-chain history.

Order books are complete, tip-fenced snapshots. Changed snapshots remove absent
orders, restore remaining quantities and status, and update transaction index,
inclusion block and expiry after re-mining. Digests commit only after upserts and
deletions; an interrupted deletion retries. Non-expiring orders remain supported.
The unchanged-book path still skips all order writes.

Tests cover retained URL caches, a fork beyond the moving probe, empty-block
identity changes, no common ancestor, mid-pass forks and restart, equal-total
replacement mints, shortened height, complete book deletion and re-mined orders.
As before, reads may observe partial progress during a pass; this is a resumable
indexer, not a globally atomic snapshot across every table and external service.
