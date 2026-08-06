# launchpad

The XCP-69 launchpad for xcp.fun — trustless token launches on Counterparty
fairmint pools. All-or-nothing mints, ≥69 participants required, on-chain
pre-announcement before minting opens, every raised XCP locked into an AMM pool
with burned LP. Enforced by consensus, not by this website.

- **[PLAN.md](./PLAN.md)** — architecture, pages, phases, research findings
- **[docs/xcp-69.md](./docs/xcp-69.md)** — the standard (fixed parameters, conformance predicate)

## Stack

Next.js App Router on a Cloudflare Worker via `@opennextjs/cloudflare` — the
same pattern as xcp-explorer and exchange. No database: renders from the
Counterparty API (`api.counterparty.io:4000/v2`) and api.xcp.io with edge/ISR
caching. Wallet integration is the exchange repo's zero-dependency SDK against
the XCP Wallet extension (`src/lib/wallet/`).

## Develop

```
npm install
npm run dev        # local
npm run check      # tsc + lint
npm run preview    # build + wrangler preview
npm run deploy     # build + deploy worker
```
