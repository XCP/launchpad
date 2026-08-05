# Claude Code Instructions

- This site surfaces ONLY XCP-69-conforming fairminters. The conformance
  predicate in `src/lib/xcp69.ts` is the editorial policy — exact equality on
  the standard's raw values, never ranges. Change it only when docs/xcp-69.md
  changes.
- All standard math is done in raw integer satoshi units. `pool_quantity` and
  `max_mint_per_address` have no `_normalized` API fields — never assume one.
- `earned_quantity` / `paid_quantity` / `commission` come back `null` for
  fairminters with no mints; guard before arithmetic (the old xcp.fun rendered
  NaN from this).
- Success and failure both end at status `closed`; a TOKEN/XCP pool row is the
  launched-vs-refunded oracle (`fetchPool`).
- `src/lib/wallet/` is copied from the exchange repo's SDK — keep it drop-in
  compatible; don't fork its behavior casually.
- Paginate the Counterparty API with `next_cursor` to exhaustion; never
  hardcode a page limit as if it were the universe.
