# Trade-history recovery

On 7 September 2026, the production Launchpad activity endpoint returned zero FEWGOODMAN trades while Core returned thirteen valid pool matches. The latest observed match was transaction `946763988baefcdace10d0088fb07430579e6a6bb971d47b3c6af6fe5de7bf17` at block 965963: 1,007,297.66778896 FEWGOODMAN received for 13.1 XCP. Core reports FEWGOODMAN as divisible. There were no completed order-book matches in that snapshot.

The local browser now renders those thirteen fills. The production database and deployment were not modified. Production indexer logs could not be inspected with the available Cloudflare authorization, so the reproduced retry defect is not asserted to be the only cause of production lag.

## Recovery behavior

Launch sync persists a new pool reserve before event ingestion. Previously, if either match feed failed, the next tick could compare against the already-updated launch row, see an unchanged pool, and skip unindexed trades indefinitely. A separate `events_pool:<asset>` acknowledgement now records the reserve only after the complete ingestion pass succeeds. Missing markers cause a pass from the existing event cursor; no schema migration is required.

The activity table checks an empty/unavailable index against both Core venues. A newer room snapshot also detects a populated index missing known fills, including fills in the same block. Fallback reads complete pagination and rejects failed feeds, malformed cursors, repeated cursors, and bounded truncation rather than showing a partial count as complete. A fallback snapshot remains the source for subsequent pages; it refreshes when viewing page one. That prevents switching between live and indexed ordering mid-pagination. The guard permits at most 200 pages of 500 matches per venue and reports unavailable if exhausted.

Order remaining amounts use each leg's actual asset identity and divisibility. In particular, a raw indivisible quantity of 100 displays as 100, not 0.000001. XCP uses eight places independently. Unknown generic order divisibility displays unavailable units instead of assuming XCP precision.

## Verification

Regression tests use Miniflare D1 to reproduce feed failure after a reserve change, then recover on an unchanged subsequent tick without duplicate insertion. Reader tests cover more than fifty fills, source stability across pages, same-block missing fills, failed venues and cursor loops. Unit tests cover divisible and indivisible tokens, both directions, foreign pairs and unsafe raw values. Actual Chromium reads the local FEWGOODMAN page against the live production index/Core mismatch and displays thirteen rows.
