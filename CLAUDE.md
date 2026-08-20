# Claude Code Instructions

This is a monorepo: `apps/web` is the Next.js site (deployed to Cloudflare
Workers), `apps/api` is a small Hono + D1 worker that mirrors the slice of
Counterparty data the site needs answered fast and cheap (the launch index,
and the per-launch conformance verdict). `apps/web` still talks to
Counterparty directly for everything else — balances, fee rates, live mint
progress, wallet composes — that traffic is free and stays in the browser.

- This site surfaces ONLY XCP-69-conforming fairminters. The conformance
  predicate in `apps/web/src/lib/xcp69.ts` is the editorial policy — exact
  equality on the standard's raw values, never ranges. Change it only when
  docs/xcp-69.md changes. `apps/api` must derive the same verdict from the
  same predicate, never a re-implementation.
- All standard math is done in raw integer satoshi units. Counterparty Core 11.3+
  adds `_normalized` companions for `pool_quantity` and `max_mint_per_address`
  under `verbose=true`, but conformance and indexing stay raw for exact integer
  comparison and for event/mempool responses that are not verbose.
- `earned_quantity` / `paid_quantity` / `commission` come back `null` for
  fairminters with no mints; guard before arithmetic (the old xcp.fun rendered
  NaN from this).
- Success and failure both end at status `closed`; a TOKEN/XCP pool row is the
  launched-vs-refunded oracle (`fetchPool`).
- `apps/web/src/lib/wallet/` is copied from the exchange repo's SDK — keep it
  drop-in compatible; don't fork its behavior casually.
- Paginate the Counterparty API with `next_cursor` to exhaustion; never
  hardcode a page limit as if it were the universe.
- D1 bills every row a statement touches, not every row that changed. Every
  write in `apps/api`'s indexer must be delta-guarded (`WHERE col IS NOT
  excluded.col`) — an unconditional upsert over a full listing on a 2-minute
  cron is exactly how a prior project's D1 bill hit $21,937 in one month.
  Mint rows are append-only (`INSERT OR IGNORE`) and never re-written.
