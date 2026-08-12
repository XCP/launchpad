import { XCP69_MIN_PARTICIPANTS, XCP69_OPENING_MULTIPLE } from "@/lib/xcp69";
import {
  COMPOSE_LAUNCH_SNIPPET,
  COMPOSE_MINT_SNIPPET,
  CURL_HOLDERS,
  CURL_OPEN_LAUNCHES,
  CURL_POOL,
  EVENTS,
  FEE_ROWS,
  PREDICATE_SNIPPET,
} from "@/app/docs/_lib/snippets";

/**
 * The docs as one markdown document — for the copy button, i.e. for pasting
 * into an LLM or a README. Prose is condensed from the page; every code
 * block and table comes from the same shared snippets the page renders, so
 * the copyable version can't drift on the load-bearing parts.
 */
export function docsMarkdown(): string {
  const mult = XCP69_OPENING_MULTIPLE.toFixed(2);
  return `# xcp.fun docs — the XCP-69 launch standard

XCP-69 is a fixed-parameter token launch standard built on Counterparty
fairmint pools (protocol feature \`fairmint_pool\`, mainnet block 961,100,
core v11.2.0+). There is no factory contract, no admin key, no platform
custody: the protocol is the platform. Every launch is identical — 100M
supply, 69M public sale at 0.01 XCP per 1,000-token lot, 31M reserved for
the pool, 10 XCP per-address cap, an on-chain pre-announcement before
minting opens, and a 1,000-block (~7 day) window.

## Launch mechanism

Four phases:

1. **Announce** — the launch confirms on-chain before its \`start_block\`;
   consensus rejects every mint until that block arrives. No stealth
   launches, no creator front-running.
2. **Mint** — 1,000 blocks from start. Whole 1,000-token lots at 0.01 XCP,
   max 1,000,000 tokens (10 XCP) per address. Paid XCP and minted tokens
   both sit in escrow at the unspendable address.
3. **Resolve** — all-or-nothing at the 69M soft cap, which equals the whole
   sale: reaching it IS selling out. Sell out → the pool seeds; miss the
   deadline → every minter is refunded automatically and the escrowed
   supply is destroyed. Resolution is end-of-block even on a hard-cap fill
   (anti-sandwich).
4. **Trade** — all 690 raised XCP + 31M tokens seed a TOKEN/XCP pool; LP
   tokens are minted to the unspendable address (locked forever). The pool
   opens at 69/31 ≈ ${mult}× mint price. The 10 XCP cap means selling out
   takes at least ${XCP69_MIN_PARTICIPANTS} distinct addresses.

## Trading and pricing

Graduated tokens trade against a constant-product TOKEN/XCP pool with a
fixed 50 bps swap fee paid to the pool itself — the LP is burned, so fees
deepen the locked liquidity. Counterparty's DEX order is the single trading
primitive: matching routes through the pool whenever the pool's marginal
price beats the order book, so a "market order" is an order at the router's
quoted output, and a "limit order" rests on the book until counter-orders —
or the pool's own price crossing yours — fill it. Price = XCP reserve ÷
token reserve. "Market cap" = price × 100M supply — a convention, not a
promise.

## Fees

${FEE_ROWS.map(([k, v]) => `- ${k}: ${v}`).join("\n")}

The only costs anywhere are Bitcoin transaction fees, the 0.5 XCP
asset-name registration fee, and the protocol's pooldeposit gas fee
(prepaid by the creator at launch).

## Risk disclosures

- The per-address cap is sybil-resistant in cost only, not in principle.
- Refunds return XCP quantity, not fiat value.
- The ${mult}× opening premium is structural, not a price guarantee — the
  pool floor decays as people sell into it.
- Token media is on-chain only if the creator chooses (taproot inscription);
  by default the chain carries the metadata URL permanently while the
  content is hosted off-chain, editable only by the asset's current owner
  via a BIP-322-signed message.

## Integration

- **Chain:** Counterparty on Bitcoin mainnet.
- **API base:** \`https://api.counterparty.io:4000/v2\` (or run your own
  counterparty-core node).
- **Messages:** launches are \`fairminter\` (ID 90) with \`pool_quantity\` and
  \`lp_asset\` set; mints are \`fairmint\` (ID 91) in whole-lot multiples.
- **Raw units:** all standard math is raw integer satoshis (×10⁸);
  \`pool_quantity\` and \`max_mint_per_address\` have NO \`_normalized\`
  siblings in the API.

### Composing a launch

\`\`\`bash
${COMPOSE_LAUNCH_SNIPPET}
\`\`\`

Consensus enforces \`soft_cap = hard_cap − premint − pool_quantity\` whenever
\`pool_quantity > 0\` — all-or-nothing is a protocol rule. The issuer needs
the 0.5 XCP name fee plus the pooldeposit gas fee on-ledger at confirmation.
Pick \`lp_asset\` with real randomness: numeric issuance is free and the
unissued check runs at parse, so a predictable name can be front-run.

### Composing a mint

\`\`\`bash
${COMPOSE_MINT_SNIPPET}
\`\`\`

### Conformance

Core has no on-chain standard marker; conformance is exact equality against
the fairminter record. This is the function this site runs:

\`\`\`ts
${PREDICATE_SNIPPET}
\`\`\`

Two deliberate inequalities: \`start_block\` must exceed the confirmation
block (otherwise a creator could broadcast a nominal 1,000-block sale late
and run a near-instant insider mint), and the window check relaxes to \`<=\`
once closed because core rewrites \`soft_cap_deadline_block\` to the fill
block on early sell-outs — the original value survives in the append-only
NEW_FAIRMINTER event (\`GET /v2/transactions/<tx_hash>/events/NEW_FAIRMINTER\`),
which is how closed launches are verified exactly.

House style (NOT conformance): the LP name format (18 digits, starts 69,
ends 69, ≡ 69 mod 97) and the hosted-JSON description. Any unissued numeric
\`lp_asset\` and any description conform.

### Events

${EVENTS.map(([k, v]) => `- \`${k}\` — ${v}`).join("\n")}

### Reading state

\`\`\`bash
${CURL_OPEN_LAUNCHES}
\`\`\`

\`\`\`bash
${CURL_POOL}
\`\`\`

\`\`\`bash
${CURL_HOLDERS}
\`\`\`

Lifecycle detection: \`pending\` → scheduled; \`open\` → minting; \`closed\` +
pool row → graduated; \`closed\` with no pool row → refunded (corroborate
with the destruction tagged "soft cap not reached"). Success and failure
both end at \`closed\` — the pool row is the oracle. And remember the trap:
on a closed record, \`soft_cap_deadline_block\` is the settlement block, not
the composed deadline.

---

Site: https://xcp.fun · Full spec: docs/xcp-69.md in the launchpad repo.
Nothing here is investment advice; tokens can and will lose value.
`;
}
