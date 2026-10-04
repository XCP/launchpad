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
orders, restore remaining quantities and status, and refresh transaction index,
Core's block field and expiry. Core's order `block_index` can change on a later
status update; it is not proof of the original Bitcoin inclusion height or of
re-mining. Digests commit only after upserts and
deletions; an interrupted deletion retries. Non-expiring orders remain supported.
The unchanged-book path still skips all order writes.

Tests cover retained URL caches, a fork beyond the moving probe, empty-block
identity changes, no common ancestor, mid-pass forks and restart, equal-total
replacement mints, shortened height, complete book deletion and re-mined orders.
As before, reads may observe partial progress during a pass; this is a resumable
indexer, not a globally atomic snapshot across every table and external service.

## Historical audit and candles

A read-only production audit on 2026-10-04 compared 251 launches, 3,911 mints,
2,569 orders, 2,366 trade rows, 1,869 candles and 88 burns with complete Core
feeds. The source anchor remained at block 969880 during the market audit, and
the compared D1 tables were unchanged between the two reads. Launch phases,
conformance, pool reserves, order statuses/quantities, trade amounts and burns
matched. The 1,000-mint reward batch and 233 entitlements matched; its 76 payment
transactions were confirmed and their SEND/ENHANCED_SEND/MPMA_SEND amounts agreed.

The audit found reversed candle opens/closes when newest-first feeds contained
several transactions in one block. Every fill shares that block's timestamp, so
sorting by timestamp and block alone retained reverse transaction order. Candle
folding now uses the merged trades' transaction/event indexes to break ties.
Regressions cover the observed six-trade HONDACIVIC block 965496, multiple events
inside one transaction, both venues and unchanged re-reads.

258 historical candles differ from a complete chronological fold in open/close
only. No production repair was performed. Deploy the fix before applying a
reviewed, before-image-guarded candle correction; preserve high/low, volume,
trade counts and economic/payment records. A full database reset is not needed.

Legacy metadata is separate: migration 0013 deliberately left 273 older mint
indexes NULL, and migration 0025 left 475 older trade indexes at zero. Three of
those trade rows also lack event-order enrichment. These can be enriched from
canonical history without treating them as missing trades. 308 order rows differ
only in Core's mutable block field; do not classify that difference as re-mining.
