# xcp.fun Rebuild — XCP-69 Launchpad Plan

*Drafted 2026-08-05, from research across xcp-fun, xcp-explorer, exchange, counterparty-core (origin/master), the "Failure to Launch" article, and Varo/Pons as references.*

## Premise

Fairmint pools (counterparty-core v11.2.0) make the launchpad trustless end-to-end:
mint → soft cap reached → **all raised XCP seeded into a TOKEN/XCP AMM pool, LP tokens
burned at the unspendable address** → token trades immediately. Miss the soft cap →
everyone refunded, escrowed supply destroyed. No platform operator holds anything —
the old xcp-69.md draft's "requires a service operator" limitation is gone.

The site surfaces **only XCP-69-conforming fairminters**. One standard, zero
per-launch parameter reading. Everything else on Counterparty is out of scope.

### Protocol facts the product is built on (verified against core origin/master)

- **Activation**: `fairmint_pool` activated on mainnet at block **961100 — crossed
  2026-08-05** (verified: tip 961122, core v11.2.0). The feature is live NOW and no
  XCP-69 launch exists yet; shipping fast matters. Signet (block 0) and testnet4
  (147200) remain available for testing writes without real XCP.
- **All-or-nothing**: pool fairminters must satisfy
  `soft_cap == hard_cap − premint − pool_quantity` with premint 0, so reaching the
  soft cap *is* selling out. There is no partial success. Frame progress as a single
  target: "69M or refund."
- **Issuer receives none of the raised XCP.** Every satoshi of XCP paid by minters
  goes into the pool. LP is minted to `UNSPENDABLE` — liquidity is permanently locked.
  Pool fee is fixed 50 bps (XCP pair).
- **Pool opening price = mint price × (soft_cap / pool_quantity).** With 69M soft /
  31M pool, the pool opens ≈2.23× mint price — minters are structurally in profit at
  open. Surface this number.
- **Headcount floor is protocol-enforced**: `max_mint_per_address ≈ 1% of soft cap`
  ⇒ ≥100 distinct addresses required to launch. (Article: the 100–199 buyer band has
  98% six-month survival.)
- **Resolution is anti-sandwich**: even a hard-cap fill resolves in `after_block`,
  never inline, so nobody can trade the pool in its creation transaction.
- Failure leaves a `destructions` row tagged `"soft cap not reached"` — the
  graveyard's on-chain proof.

### XCP-69 conformance predicate (the site's editorial policy, one function)

```python
def is_xcp69(fm):  # raw integer fields; do NOT use *_normalized here
    lot = fm["quantity_by_price"]
    return (
        fm["status"] in ("pending", "open", "closed")
        and (fm["pool_quantity"] or 0) > 0                    # pool + LP burn + refunds
        and fm["premint_quantity"] == 0
        and fm["hard_cap"] == fm["soft_cap"] + fm["pool_quantity"]  # rules out pre-existing supply
        and (fm["minted_asset_commission_int"] or 0) == 0     # commission = stealth premine loophole
        and bool(fm["lock_quantity"])
        and (fm["max_mint_per_address"] or 0) > 0
        and fm["max_mint_per_address"] <= (fm["soft_cap"] + 99) // 100  # ≈1% of soft cap
        and fm["max_mint_per_address"] % lot == 0             # cap must be whole lots
        and fm["price"] > 0 and not fm["burn_payment"]
    )
```

Notes: core has **no** standard marker — this predicate is the standard's enforcement.
The commission clause is the one naive checks miss (protocol allows up to 99% skim per
mint; it's a premine with extra steps). Measure the 1% cap against `soft_cap`, not
`hard_cap` (hard cap includes the unmintable pool reserve). `pool_quantity` and
`max_mint_per_address` have **no `_normalized` siblings** — divide by 1e8 manually for
display only. Belt-and-braces: asset's first issuance must have
`asset_events == "open_fairminter"`. Render `lock_quantity` as *intent* until close
("supply locks at launch"), since `locked` is only written by `close_fairminter()`.

### Lifecycle → site sections

| Section | On-chain condition |
|---|---|
| **Launching** | `status IN (pending, open)` and predicate passes |
| **Launched** | `status = closed` and `GET /v2/pools/<ASSET>/XCP` returns a pool |
| **Graveyard** | `status = closed`, `pool_quantity > 0`, no pool row (corroborate: destruction tagged `soft cap not reached`) |

Caveat: `soft_cap_deadline_block` is rewritten on success (set to the fill block);
reconstruct sale windows from creation `block_index` and the pool's `block_index`.

## Architecture

**Stack: Next.js App Router on a Cloudflare Worker via @opennextjs/cloudflare** —
the exact pattern both xcp-explorer (`apps/web`) and exchange (`apps/web`) already
run. Copy the wrangler + open-next config shape from the explorer (R2 incremental
cache; custom route `xcp.fun/*`; `workers_dev = false`). Tailwind v4, SWR, no UI kit.

**One worker to start, no database.** The XCP-69 universe is small (all launches ever
will number in the dozens for a long time). Every page can render from upstream APIs
with edge/ISR caching:

- **Counterparty API** (`api.counterparty.io:4000/v2`) — canonical + real-time:
  fairminters (paginate properly with `next_cursor`; the old site's `limit=200` missed
  a third of records), fairmints per launch, mempool `NEW_FAIRMINT` events, pools,
  `pool_matches` (trade tape), `price_history` (a row per reserve mutation — the price
  series), `/pools/<a>/<b>/quote` (swap quotes), compose endpoints.
- **api.xcp.io** (explorer's D1 mirror) — enrichment: `/v2/price` + `/ticker`
  (XCP/BTC/USD), `/v2/assets/:asset` metadata, `/v2/assets/:asset/balances` (holders),
  `/holder-makeup` (concentration), `/v2/addresses/:address/{summary,reputation}`
  (minter age/reputation for the organic panel). Fairmint rows here carry timestamps
  (the raw Counterparty `fairmints` table has no time column — block join needed if
  hitting Counterparty directly).
- **cdn.xcp.io** — icons/art by URL convention, with the explorer's Cloudflare Images
  transform pattern (`/cdn-cgi/image/…/img/icon/<asset>`).

Known upstream gaps, all tolerable at this scale: `/v2/fairminters` has no `sort`
(sort client-side), no fairmint timestamps (join blocks or use the mirror), OHLC for
pool tokens doesn't exist anywhere yet (derive candles from `price_history` in the
worker; if volume grows, graduate that one computation into api.xcp.io or xcpdex-api,
both of which we control).

**Wallet integration: copy `exchange/apps/web/src/lib/wallet` wholesale.** The
`sdk/` (7 files, ~390 lines, zero deps) + `wallet-context.tsx` + `useCompose.ts` trio
is the complete connect→compose→sign→broadcast loop against the XCP Wallet extension
(`window.xcpwallet`), including MV3 transport-retry and response validation. Add two
compose wrappers in the `useCompose` style: `composeFairminter`, `composeFairmint`
(the compose API accepts `pool_quantity` and `lp_asset`).

## Pages

### 1. Home
Pons-style image-forward sections, in lifecycle order, with the standard's guarantees
one screen away:

- **Launching now** — cards: art, name, progress-to-soft-cap bar (single target,
  "sells out or refunds"), distinct minters (vs the ≥100 floor), XCP raised, blocks
  remaining (`soft_cap_deadline_block − tip` with ~10min/block ETA), mint velocity
  sparkline.
- **Launched** — cards: art, name, pool price + 24h change, XCP liquidity (pool
  reserve), holders. Sorted by recency or liquidity.
- **Graveyard** — tombstones: name, % of soft cap reached, participants, XCP refunded,
  age. Present respectfully — refunds worked; this is the standard doing its job.
- Header strip: block height (median-of-three pattern from old `lib/blockHeight.ts`),
  XCP price (ticker). Empty-state hero until the first launch exists: "fairmint pools
  are live — launch the first XCP-69" pointing at /create.

### 2. Launch detail (`/launch/<asset>`, launching state)
The "how organic does it look" page — our differentiator; no reference site has it:

- Progress: single bar to soft cap with lot math, XCP raised, ETA, "what happens at
  close" explainer (pool seeds at N× mint price / refund).
- **Mint button**: fixed-lot mint via wallet (whole multiples of `quantity_by_price`;
  cap per address enforced client-side too, showing "you can mint up to X more").
- **Live mint tape**: confirmed fairmints (address, lots, time ago) + mempool
  `NEW_FAIRMINT` pending rows, SWR-polled.
- **Organic panel**: distinct addresses (progress toward 100+), top-minter % vs the
  1% cap, repeat-mint distribution, mint-velocity chart, and per-minter address age /
  first-activity via the explorer's address summary/reputation. Honest framing note:
  the cap is per *address*, not per person.

### 3. Token detail (`/token/<asset>`, launched state)
Varo's structure, our data:

- Header: art, name, price, 24h/7d change, "market cap" (price × supply), holders,
  **Top-10-holder %** in the header stat bar.
- Chart: lightweight-charts (reuse exchange `chart.tsx` + a `price_history`→candles
  adapter). Area chart first, candles when data density justifies.
- **Swap widget**: the extension's swap-form design (send/receive cards, quote via
  `/pools/<sell>/<receive>/quote`, slippage gear, impact on receive field, min
  received; compose order with expiration=1 = immediate-or-cancel). Quote logic ports
  from exchange `usePoolSwapQuote` + our `SwapForm`.
- Trade history: `pool_matches` tape (side, amounts, price, address, time).
- Holders: explorer `holderCols` pattern (rank, address, amount, %, badges) +
  concentration bar. UNSPENDABLE shows as the LP holder — badge it "burned LP".
- Pool panel: reserves, opening-vs-current price, cumulative 50bps fees.

### 4. Graveyard detail
Frozen launch page: what it reached, participant count, the destruction tx and refund
events as proof-of-refund links. History preserved, mint tape intact.

### 5. Create (`/create`)
**Name + image + description. Nothing else.** All XCP-69 parameters are derived
constants shown as a read-only "terms" summary (supply, price, soft cap, per-address
cap, duration, pool share, "you receive none of the XCP", "liquidity locks forever").
Flow: connect wallet → check asset name availability + 0.5 XCP name fee → compose
fairminter (with `pool_quantity`, generated `lp_asset`) → sign → broadcast → launch
page in "pending" state.

- **LP naming convention**: `A69` + *random* tail (valid numeric range). Brandable,
  but not pre-squattable — a deterministic tail would let a griefer pre-issue expected
  names for pennies and invalidate launches (the "unissued" check happens at parse).
- Named assets required by the standard (article: 43.5% vs 7.3% survival).
- **Image strategy (decided)**: no inscriptions — they'd require taproot envelopes
  and exclude the legacy addresses most users launch from. Instead, the established
  **enhanced asset info** convention: we host the uploaded image + a per-asset JSON
  (`{asset, description, image}`), and the fairminter's `description` field is set to
  that JSON's URL. cdn.xcp.io's icon pipeline ingests the convention, so launched
  tokens render everywhere (wallet, explorer, other sites) for free. Upload flow:
  pick name → upload image to R2 through the site worker (keyed by asset name) →
  JSON written → compose with the URL. Mitigate off-chain mutability by making
  uploads write-once, and consider `lock_description = true` in the standard so the
  creator can't repoint metadata after launch.

### 6. Standard (`/standard`)
Host the rewritten XCP-69 spec on-site (the old site linked to GitHub — missed
opportunity). The current `docs/xcp-69.md` is the pre-protocol draft (platform
operator, DEX-order floor, 2-month expiry) — it must be rewritten around fairmint
pools before anything else, because the create screen's constants come from it.

## What gets reused from where

| From | Take |
|---|---|
| **exchange** | wallet `sdk/` + context + `useCompose` (verbatim); `usePoolSwapQuote`; `chart.tsx` + `useOhlc` shape; `trade-form` quote-preview logic; `pool-math.ts` |
| **xcp-explorer** | wrangler/OpenNext/worker config shape; 3-layer caching pattern; `lib/format.ts`; `lib/art.ts` CDN image transforms; `holderCols` + role badges + concentration bar; server/client API split (`server.ts`) |
| **xcp-fun (old)** | `lib/formatters.ts`; blockHeight median-of-three; conformance-check shape from `xcp420.ts`; holographic-gradient brand mark (now = XCP-69 conformance); parrot.gif |
| **extension (this session)** | swap form UX (send/receive cards, gear details, impact display, IOC semantics); pool overview layout |

Old-site bugs to not reimport: nullable `earned_quantity/paid_quantity/commission`
(NaN math), missing pagination, skeleton-loaders-as-empty-state, stale hardcoded
block height.

## Phases

1. **Spec first. ✅ Done 2026-08-05** — `docs/xcp-69.md` rewritten against protocol
   reality with final numbers (100M / 69M / 31M, 0.1 XCP per 1,000 lot, 690k address
   cap, 1,000 blocks). Conformance simplifies to exact-equality on fixed raw values.
2. **Scaffold.** Next.js + OpenNext worker deployed to a staging route; port
   formatters, art helpers, brand; wallet SDK in but unused. Keep Vercel serving
   xcp.fun until cutover.
3. **Read-only launchpad vs signet/testnet4** (fairmint pools are live there now):
   conformance predicate, home three-states, launch detail with mint tape, graveyard.
   Seed test launches ourselves to exercise every state.
4. **Wallet actions**: mint flow, create flow (constants from the spec), pending
   states from mempool.
5. **Market layer**: price series adapter, chart, swap widget, trades, holders.
6. **Organic analytics**: minter reputation/age, concentration, velocity — the
   article's survival predictors as UI.
7. **Harden + launch**: per-launch OG images (workers-og), SEO, edge caching, DNS
   cutover. No external clock to wait for — the feature activated 2026-08-05, so the
   schedule is purely how fast phases 1-4 ship. Consider cutting over as soon as the
   read-only launchpad + create flow work (phases 1-4) and layering the market pages
   in behind the first launches' ~week-long mint windows.

## Open questions (need your call)

1. ~~**Token image strategy**~~ **Resolved**: hosted image + hosted enhanced-asset-info
   JSON, with the fairminter description set to the JSON URL (see Create page). No
   inscriptions — they'd exclude legacy-address users. Remaining sub-decisions: where
   the JSON/images live (xcp.fun worker + its own R2 vs the cdn.xcp.io worker
   directly), and whether the standard mandates `lock_description`.
2. ~~**Final XCP-69 numbers**~~ **Resolved** — 100M supply / 69M soft cap / 31M pool,
   0.1 XCP per 1,000-token lot, 690k per-address cap, 1,000-block window. Raise is
   exactly 6,900 XCP; pool opens 2.23× mint; ≥100 addresses required. Spec rewritten:
   `docs/xcp-69.md` (conformance is now exact-equality on the fixed values).
3. **Where aggregations live long-term** if traffic grows: extend api.xcp.io (D1
   mirror already ingests fairminter/pool events) vs xcpdex-api (has OHLC machinery)
   vs a new D1 for xcp.fun. Recommendation: start with none; first graduation is the
   candle endpoint into api.xcp.io.
4. **Theme**: explorer components are dark-only; old xcp.fun is light. Adopting
   explorer table/holder components implies dark (or a real retrofit).
5. **Domain naming**: you said "launchpad at xcp.com" but everything points at
   xcp.fun — assuming xcp.fun.
