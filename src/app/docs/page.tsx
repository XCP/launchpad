import Link from "next/link";
import {
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
} from "@/lib/xcp69";

export const metadata = {
  title: "Docs — xcp.fun",
  description:
    "Everything about XCP-69, in one place: how launches work, how pricing works, what graduation means, what it costs (nothing), and how to integrate.",
};

const TOC: { section: string; items: [string, string][] }[] = [
  {
    section: "About",
    items: [
      ["#overview", "Overview"],
      ["#launch-mechanism", "Launch mechanism"],
      ["#trading-and-pricing", "Trading and pricing"],
      ["#graduation", "Graduation"],
      ["#fees", "Fees"],
      ["#risk-disclosures", "Risk disclosures"],
    ],
  },
  {
    section: "Integration",
    items: [
      ["#network", "Network"],
      ["#message-format", "Message format"],
      ["#composing", "Composing transactions"],
      ["#conformance", "Conformance"],
      ["#onchain-events", "Onchain events"],
      ["#reading-state", "Reading state"],
      ["#reference-launch", "Reference launch"],
      ["#support-and-terms", "Support & terms"],
    ],
  },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

const PREDICATE_SNIPPET = `export const XCP69 = {
  /** 100M supply */
  HARD_CAP: 10_000_000_000_000_000,
  /** 69M public sale — reaching it IS selling out (all-or-nothing) */
  SOFT_CAP: 6_900_000_000_000_000,
  /** 31M seeded into the TOKEN/XCP pool at close, LP burned */
  POOL_QUANTITY: 3_100_000_000_000_000,
  /** 1,000-token lots */
  QUANTITY_BY_PRICE: 100_000_000_000,
  /** 0.01 XCP per lot */
  PRICE: 1_000_000,
  /** 1M tokens = 10 XCP per address; 69M ÷ 1M = 69 participants */
  MAX_MINT_PER_ADDRESS: 100_000_000_000_000,
  MAX_MINT_PER_TX: 100_000_000_000_000,
  /** Mint window: soft_cap_deadline_block − start_block, exactly (~7 days) */
  DEADLINE_BLOCKS: 1_000,
} as const;

/** core's block_index sentinel for unconfirmed transactions */
const MEMPOOL_BLOCK_INDEX = 9_999_999;

export function isXcp69(fm: Fairminter): boolean {
  return (
    (fm.status === "pending" || fm.status === "open" || fm.status === "closed") &&
    fm.pool_quantity === XCP69.POOL_QUANTITY &&
    fm.soft_cap === XCP69.SOFT_CAP &&
    fm.hard_cap === XCP69.HARD_CAP &&
    fm.quantity_by_price === XCP69.QUANTITY_BY_PRICE &&
    fm.price === XCP69.PRICE &&
    fm.max_mint_per_address === XCP69.MAX_MINT_PER_ADDRESS &&
    fm.max_mint_per_tx === XCP69.MAX_MINT_PER_TX &&
    fm.premint_quantity === 0 &&
    (fm.minted_asset_commission_int ?? 0) === 0 &&
    fm.lock_quantity &&
    fm.lock_description &&
    fm.divisible &&
    !fm.burn_payment &&
    !fm.asset.startsWith("A") && // named assets only
    // timing: scheduled start, fixed window, no end_block
    fm.start_block > 0 &&
    fm.end_block === 0 &&
    (fm.confirmed === false ||
      fm.block_index >= MEMPOOL_BLOCK_INDEX || // unconfirmed sentinel
      fm.start_block > fm.block_index) &&      // confirmed before start
    (fm.status === "closed"
      // core rewrites the deadline to the fill block on early sell-out
      ? fm.soft_cap_deadline_block <= fm.start_block + XCP69.DEADLINE_BLOCKS
      : fm.soft_cap_deadline_block === fm.start_block + XCP69.DEADLINE_BLOCKS)
  );
}`;

const COMPOSE_LAUNCH_SNIPPET = `# Compose an XCP-69 launch (unsigned tx back; sign + broadcast yourself).
# START = a future block: the pre-announcement window. The launch must
# CONFIRM before START or it opens instantly and fails conformance.
curl -G "https://api.counterparty.io:4000/v2/addresses/$ISSUER/compose/fairminter" \\
  --data-urlencode "asset=MYTOKEN" \\
  --data-urlencode "price=1000000" \\
  --data-urlencode "quantity_by_price=100000000000" \\
  --data-urlencode "hard_cap=10000000000000000" \\
  --data-urlencode "soft_cap=6900000000000000" \\
  --data-urlencode "pool_quantity=3100000000000000" \\
  --data-urlencode "lp_asset=$LP_NAME" \\  # any unissued numeric; house style: 69…69, ≡69 (mod 97)
  --data-urlencode "max_mint_per_address=100000000000000" \\
  --data-urlencode "max_mint_per_tx=100000000000000" \\
  --data-urlencode "start_block=$START" \\
  --data-urlencode "soft_cap_deadline_block=$((START + 1000))" \\
  --data-urlencode "end_block=0" \\
  --data-urlencode "premint_quantity=0" \\
  --data-urlencode "minted_asset_commission=0" \\
  --data-urlencode "burn_payment=false" \\
  --data-urlencode "lock_quantity=true" \\
  --data-urlencode "lock_description=true" \\
  --data-urlencode "divisible=true" \\
  --data-urlencode "description=https://…/MYTOKEN.json" \\
  --data-urlencode "sat_per_vbyte=$FEE_RATE" \\
  --data-urlencode "verbose=true"`;

const COMPOSE_MINT_SNIPPET = `# Compose a mint. quantity is the TOKEN amount (raw, whole lots) —
# the XCP price is computed by consensus and debited from the minter's
# on-ledger XCP balance; nothing rides in the Bitcoin outputs.
curl -G "https://api.counterparty.io:4000/v2/addresses/$MINTER/compose/fairmint" \\
  --data-urlencode "asset=MYTOKEN" \\
  --data-urlencode "quantity=100000000000000" \\
  --data-urlencode "sat_per_vbyte=$FEE_RATE"

# Issuer-side XCP cost of the pool settlement (prepaid at creation):
curl "https://api.counterparty.io:4000/v2/addresses/$ISSUER/compose/pooldeposit/estimatexcpfees"`;

const CURL_OPEN_LAUNCHES = `# All fairminters currently minting (filter with isXcp69 client-side)
curl "https://api.counterparty.io:4000/v2/fairminters?status=open&verbose=true"

# Every mint into one launch
curl "https://api.counterparty.io:4000/v2/fairminters/<TX_HASH>/fairmints"`;

const CURL_POOL = `# Pool state (reserves) — a row here means the launch graduated
curl "https://api.counterparty.io:4000/v2/pools/<ASSET>/XCP"

# Price series: one row per reserve mutation
curl "https://api.counterparty.io:4000/v2/pools/<ASSET>/XCP/price_history"

# Swap quote for a given input quantity (raw integer)
curl "https://api.counterparty.io:4000/v2/pools/<ASSET>/XCP/quote?quantity=100000000"`;

const CURL_HOLDERS = `# Holders — the unspendable address appears holding the burned LP
curl "https://api.counterparty.io:4000/v2/assets/<ASSET>/holders"`;

const FEE_ROWS: [string, string][] = [
  ["Creator's share of the 690 XCP raise", "0%"],
  ["Protocol / platform share of the raise", "0%"],
  ["Premine or mint commission to the creator", "0"],
  ["LP tokens", "burned at the unspendable address, forever"],
  ["Swap fee after launch", "50 bps, paid to the pool (the LP is burned, so it deepens locked liquidity)"],
];

const EVENTS: [string, string][] = [
  ["NEW_FAIRMINTER", "a launch is created"],
  ["NEW_FAIRMINT", "someone mints (also visible in the mempool before confirmation)"],
  ["OPEN_POOL", "the launch graduated — the TOKEN/XCP pool was seeded"],
  ["POOL_MATCH", "a swap executed against the pool"],
  ["ASSET_DESTRUCTION", "escrowed supply destroyed — on a missed soft cap, tagged “soft cap not reached”"],
];

export default function DocsPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-10">
      <div>
        <h1 className="text-3xl font-bold">Docs</h1>
        <p className="mt-2 text-gray-600">
          Everything about XCP-69, in one place. The first half explains how
          launches work for anyone. The second half is for developers who want
          to read or build on the same on-chain data this site does.
        </p>
      </div>

      <nav className="grid gap-4 sm:grid-cols-2">
        {TOC.map(({ section, items }) => (
          <div
            key={section}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {section}
            </h2>
            <ul className="mt-2 space-y-1 text-sm font-medium">
              {items.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="text-gray-700 hover:text-purple-600">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ---------------------------------------------------------------- */}

      <section id="overview" className="space-y-3">
        <h2 className="text-xl font-bold">Overview</h2>
        <p className="text-sm text-gray-700">
          XCP-69 is a fixed-parameter token launch standard built on
          Counterparty <strong>fairmint pools</strong>. There is no factory
          contract, no admin key, and no platform custody at any point:
          the protocol <em>is</em> the platform. Every action — creating a
          launch, minting, swapping — is a transaction you sign in your own
          wallet and broadcast to Bitcoin. This site is an interface over
          public on-chain data; if it disappeared tomorrow, every launch,
          refund, and pool would keep working exactly as before.
        </p>
        <p className="text-sm text-gray-700">
          Every XCP-69 launch is identical: 100M supply, 69M public sale at
          0.01 XCP per 1,000-token lot, 31M reserved for the liquidity pool,
          10 XCP per-address cap, an on-chain pre-announcement before minting
          opens, and a 1,000-block window. There is no fine print to read
          because there is no fine print. The full parameter set lives on
          the <Link href="/faq" className="text-purple-600 underline">How it works</Link> page.
        </p>
      </section>

      <section id="launch-mechanism" className="space-y-3">
        <h2 className="text-xl font-bold">Launch mechanism</h2>
        <div className="holo-border rounded-xl p-5 text-sm text-gray-700">
          <strong>The inversion:</strong> on most launchpads, trading starts
          instantly and the crowd arrives later, if ever. XCP-69 flips this —
          trading cannot begin until the community has fully funded the
          launch. The 10 XCP per-address cap means the 69M sale is unreachable
          without at least {XCP69_MIN_PARTICIPANTS} distinct addresses. By
          construction, no token trades before a real crowd has paid for it.
        </div>
        <p className="text-sm text-gray-700">A launch moves through four phases:</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Announce.</strong> Every launch confirms on-chain{" "}
            <em>before</em> its <code className="rounded bg-gray-100 px-1">start_block</code>.
            Until that block arrives the fairminter is{" "}
            <code className="rounded bg-gray-100 px-1">pending</code> and
            consensus rejects every mint — nobody, creator included, can mint
            early. There are no stealth launches: the full terms sit on-chain,
            inspectable, before the first lot can be bought.
          </li>
          <li>
            <strong>Mint.</strong> A 1,000-block window (~7 days) from{" "}
            <code className="rounded bg-gray-100 px-1">start_block</code>.
            Anyone can mint whole 1,000-token lots at 0.01 XCP per lot, up to
            1,000,000 tokens (10 XCP) per address. Both the paid XCP and the
            minted tokens sit in escrow at the unspendable address — nobody
            holds anything until the launch resolves. The window length only
            ever delays failure: a sell-out settles the moment it fills, while
            a miss frees every minter&apos;s XCP within about a week.
          </li>
          <li>
            <strong>Resolve.</strong> All-or-nothing at the 69M soft cap. The
            soft cap equals the entire public sale, so reaching it{" "}
            <em>is</em> selling out — there is no partial success. Sell out
            and the pool seeds; miss the deadline and the protocol refunds
            every minter automatically and destroys the escrowed supply.
            Resolution happens at end-of-block even on a hard-cap fill, so
            nobody can trade the pool in the transaction that creates it.
          </li>
          <li>
            <strong>Trade.</strong> All 690 raised XCP plus the 31M reserved
            tokens seed a TOKEN/XCP AMM pool. The LP tokens are minted
            directly to the unspendable address — liquidity is locked by
            consensus, permanently. Supply and description lock in the same
            block, and trading is live immediately.
          </li>
        </ol>
      </section>

      <section id="trading-and-pricing" className="space-y-3">
        <h2 className="text-xl font-bold">Trading and pricing</h2>
        <p className="text-sm text-gray-700">
          Graduated tokens trade against a constant-product TOKEN/XCP pool.
          The price is simply the ratio of the pool&apos;s reserves; every
          swap moves it. A fixed <strong>50 bps</strong> fee on each swap is
          paid to the pool itself — and since the LP is burned, fees deepen
          the locked liquidity rather than paying anyone out.
        </p>
        <p className="text-sm text-gray-700">
          The pool opens with 690 XCP against 31M tokens: 69/31 ≈{" "}
          {XCP69_OPENING_MULTIPLE.toFixed(2)}× the mint price. Every minter is
          structurally in profit at open, and the pool — not later buyers —
          absorbs early exits.
        </p>
        <dl className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          {(
            [
              [
                "Price",
                "XCP reserve ÷ token reserve. Moves with every swap; there is no order book and no market maker.",
              ],
              [
                "Market cap",
                "Pool price × 100M total supply. A convention, not a promise — the pool could not pay it out.",
              ],
              [
                "Price impact",
                "How much your own swap moves the price. Larger swaps against the fixed reserves get a worse average price.",
              ],
              [
                "Slippage",
                "The difference between the quoted price and what executes, if the pool moves between your quote and your confirmation.",
              ],
            ] as [string, string][]
          ).map(([term, def]) => (
            <div key={term} className="px-4 py-3">
              <dt className="font-medium">{term}</dt>
              <dd className="mt-0.5 text-gray-600">{def}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="graduation" className="space-y-3">
        <h2 className="text-xl font-bold">Graduation</h2>
        <p className="text-sm text-gray-700">
          On other launchpads, graduation is a threshold inside a live market:
          the token trades on a curve while everyone hopes it reaches the
          magic number. XCP-69 graduation is <strong>binary</strong> and
          happens before any trading exists. Sell out the 69M sale within
          1,000 blocks and the launch graduates — pool seeded, LP burned,
          supply locked, trading live in the same block&apos;s resolution
          phase. Miss it and the launch never trades at all.
        </p>
        <p className="text-sm text-gray-700">
          Refunds are not a support process. They are automatic protocol
          behavior: at the deadline, every minter&apos;s XCP is returned and
          the escrowed supply is destroyed in the same block. Failed launches
          move to the graveyard, where their history is preserved — the mint
          tape, the participant count, and the on-chain proof: a destruction
          record tagged <em>&quot;soft cap not reached&quot;</em>.
        </p>
      </section>

      <section id="fees" className="space-y-3">
        <h2 className="text-xl font-bold">Fees</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <dl className="divide-y divide-gray-100 text-sm">
            {FEE_ROWS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-gray-500">{k}</dt>
                <dd className="max-w-[55%] text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-sm text-gray-700">
          There is no fee-split table because there are no fees to split.
          Every satoshi of XCP paid by minters goes into the pool. The only
          costs anywhere in the system are Bitcoin transaction fees, the
          0.5 XCP asset-name registration fee for named assets, and the
          protocol&apos;s pooldeposit gas fee debited at creation — costs paid
          to the network, not to us or to the creator.
        </p>
      </section>

      <section id="risk-disclosures" className="space-y-3">
        <h2 className="text-xl font-bold">Risk disclosures</h2>
        <p className="text-sm text-gray-700">
          The standard removes the rug pull and the premine. It does not
          remove risk, and we won&apos;t pretend otherwise:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>The per-address cap is sybil-resistant in cost only, not
            in principle.</strong> The cap is per address, not per person. It
            raises the cost of faking a crowd of {XCP69_MIN_PARTICIPANTS}; it
            cannot prevent one.
          </li>
          <li>
            <strong>Refunds return XCP quantity, not fiat value.</strong> If
            XCP&apos;s price moves during the ~7-day window, a refund makes
            you whole in XCP terms only.
          </li>
          <li>
            <strong>
              The {XCP69_OPENING_MULTIPLE.toFixed(2)}× opening premium is
              structural, not a price guarantee.
            </strong>{" "}
            The pool floor decays as people sell into it. Nothing stops a
            token from trading below mint price.
          </li>
          <li>
            <strong>Token media is on-chain only if the creator chooses.</strong>{" "}
            By default the chain permanently carries the URL of the asset-info
            JSON (via{" "}
            <code className="rounded bg-gray-100 px-1">lock_description</code>)
            while the image and info are hosted off-chain, editable only by
            the asset&apos;s current on-chain owner via a wallet-signed
            message. If that hosting ever vanished, the token&apos;s
            economics — supply, pool, refunds — are untouched; only the
            artwork would be. Creators launching from a taproot wallet can
            remove the dependency entirely by inscribing the image on-chain
            as the permanent description.
          </li>
        </ul>
      </section>

      {/* ---------------------------------------------------------------- */}

      <div className="border-t border-gray-200 pt-8">
        <h2 className="text-2xl font-bold">Integration</h2>
        <p className="mt-2 text-sm text-gray-600">
          Everything this site displays comes from public APIs. You can build
          your own launchpad, bot, or dashboard on the same data — nothing
          below requires our permission.
        </p>
      </div>

      <section id="network" className="space-y-3">
        <h2 className="text-xl font-bold">Network</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>
            <strong>Chain:</strong> Counterparty on Bitcoin mainnet. XCP-69
            launches are ordinary Bitcoin transactions carrying Counterparty
            messages.
          </li>
          <li>
            <strong>API base:</strong>{" "}
            <code className="rounded bg-gray-100 px-1">
              https://api.counterparty.io:4000/v2
            </code>{" "}
            — or run your own counterparty-core node for trustless reads.
          </li>
          <li>
            <strong>Protocol feature:</strong>{" "}
            <code className="rounded bg-gray-100 px-1">fairmint_pool</code>,
            activated on mainnet at block 961,100 (2026-08-05). Requires
            core v11.2.0+.
          </li>
        </ul>
      </section>

      <section id="message-format" className="space-y-3">
        <h2 className="text-xl font-bold">Message format</h2>
        <p className="text-sm text-gray-700">
          Launches use the <strong>fairminter</strong> message (ID 90) with
          the pool fields <code className="rounded bg-gray-100 px-1">pool_quantity</code>{" "}
          and <code className="rounded bg-gray-100 px-1">lp_asset</code> set.
          Mints are ordinary fairmint messages in whole-lot multiples of{" "}
          <code className="rounded bg-gray-100 px-1">quantity_by_price</code>.
        </p>
        <p className="text-sm text-gray-700">
          One integration trap worth knowing:{" "}
          <code className="rounded bg-gray-100 px-1">pool_quantity</code> and{" "}
          <code className="rounded bg-gray-100 px-1">max_mint_per_address</code>{" "}
          have <strong>no <code className="rounded bg-gray-100 px-1">_normalized</code> siblings</strong>{" "}
          in the API. Do all standard math in raw integer satoshi units
          (×10⁸) and divide by 10⁸ only for display.
        </p>
      </section>

      <section id="composing" className="space-y-3">
        <h2 className="text-xl font-bold">Composing transactions</h2>
        <p className="text-sm text-gray-700">
          The compose API returns an <strong>unsigned</strong> raw Bitcoin
          transaction — the node never sees a key. Sign with your own wallet,
          broadcast, done. Add{" "}
          <code className="rounded bg-gray-100 px-1">verbose=true</code> for a
          PSBT and echoed params; every quantity is a raw integer.
        </p>
        <CodeBlock>{COMPOSE_LAUNCH_SNIPPET}</CodeBlock>
        <p className="text-sm text-gray-700">
          Consensus enforces the standard&apos;s coherence at parse time:{" "}
          <code className="rounded bg-gray-100 px-1">soft_cap</code> must equal{" "}
          <code className="rounded bg-gray-100 px-1">
            hard_cap − premint − pool_quantity
          </code>{" "}
          whenever <code className="rounded bg-gray-100 px-1">pool_quantity</code>{" "}
          &gt; 0 — all-or-nothing is a protocol rule, not site policy. The
          issuer&apos;s address must hold the 0.5 XCP name-registration fee
          plus the pooldeposit gas fee on-ledger; both debit at confirmation,
          so settlement later costs nothing. Pick{" "}
          <code className="rounded bg-gray-100 px-1">lp_asset</code> with real
          randomness: numeric issuance is free, and a predictable name lets
          anyone pre-register it between broadcast and confirmation,
          invalidating the launch.
        </p>
        <CodeBlock>{COMPOSE_MINT_SNIPPET}</CodeBlock>
        <p className="text-sm text-gray-700">
          Mints must be whole-lot multiples of{" "}
          <code className="rounded bg-gray-100 px-1">quantity_by_price</code>,
          within the per-transaction cap, and within the address&apos;s
          remaining allowance — a partially used cap can be topped up across
          multiple transactions. The minter needs the XCP{" "}
          <em>on their Counterparty balance</em>; a funded BTC wallet with no
          XCP will compose-fail with{" "}
          <em>&quot;insufficient XCP balance&quot;</em>.
        </p>
      </section>

      <section id="conformance" className="space-y-3">
        <h2 className="text-xl font-bold">Conformance</h2>
        <p className="text-sm text-gray-700">
          Core has no on-chain standard marker, so conformance is a predicate:
          exact equality against the standard&apos;s fixed raw values. This is
          the actual function this site runs — a launch either passes it or is
          not XCP-69.
        </p>
        <CodeBlock>{PREDICATE_SNIPPET}</CodeBlock>
        <p className="text-sm text-gray-700">
          The commission clause is the one naive checks miss. The protocol
          allows a fairminter to skim up to 99% of every mint back to the
          creator — a premine with extra steps — and no other field catches
          it. XCP-69 requires it to be exactly 0.
        </p>
        <p className="text-sm text-gray-700">
          The timing clauses are the two deliberate inequalities. Consensus
          does not require a future start — a launch confirming late simply
          opens instantly — so the pre-announcement guarantee lives here:{" "}
          <code className="rounded bg-gray-100 px-1">start_block</code> must
          exceed the confirmation block. Without that clause, a creator could
          broadcast a nominal 1,000-block sale late, confirm just before its
          own deadline, and run a near-instant insider mint behind
          thousand-block metadata. And on the fairminter row the window check
          relaxes to <code className="rounded bg-gray-100 px-1">≤</code> once
          closed because core rewrites the deadline on early sell-out — for
          closed launches this site restores exact equality from the immutable{" "}
          <code className="rounded bg-gray-100 px-1">NEW_FAIRMINTER</code>{" "}
          event (see the trap in Reading state). Everything else is exact
          equality on the row.
        </p>
      </section>

      <section id="onchain-events" className="space-y-3">
        <h2 className="text-xl font-bold">Onchain events</h2>
        <p className="text-sm text-gray-700">
          The full lifecycle is observable as Counterparty events via{" "}
          <code className="rounded bg-gray-100 px-1">
            GET /v2/events/&lt;EVENT&gt;
          </code>
          :
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <dl className="divide-y divide-gray-100 text-sm">
            {EVENTS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="font-mono text-xs font-medium">{k}</dt>
                <dd className="max-w-[60%] text-right text-gray-600">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="reading-state" className="space-y-3">
        <h2 className="text-xl font-bold">Reading state</h2>
        <p className="text-sm text-gray-700">
          Everything is curl-able. Launches and mints:
        </p>
        <CodeBlock>{CURL_OPEN_LAUNCHES}</CodeBlock>
        <p className="text-sm text-gray-700">Pools, prices, and quotes:</p>
        <CodeBlock>{CURL_POOL}</CodeBlock>
        <p className="text-sm text-gray-700">Holders:</p>
        <CodeBlock>{CURL_HOLDERS}</CodeBlock>
        <p className="text-sm text-gray-700">
          <strong>Lifecycle detection recipe.</strong> Success and failure
          both end at fairminter status <code className="rounded bg-gray-100 px-1">closed</code>,
          so the pool row is the disambiguator:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>
            <code className="rounded bg-gray-100 px-1">pending</code> →
            scheduled
          </li>
          <li>
            <code className="rounded bg-gray-100 px-1">open</code> → minting
          </li>
          <li>
            <code className="rounded bg-gray-100 px-1">closed</code> +{" "}
            <code className="rounded bg-gray-100 px-1">/v2/pools/&lt;ASSET&gt;/XCP</code>{" "}
            returns a pool → graduated
          </li>
          <li>
            <code className="rounded bg-gray-100 px-1">closed</code> with no
            pool row → refunded (corroborate with the destruction tagged
            &quot;soft cap not reached&quot;)
          </li>
        </ul>
        <p className="text-sm text-gray-700">
          <strong>Second integration trap:</strong>{" "}
          <code className="rounded bg-gray-100 px-1">soft_cap_deadline_block</code>{" "}
          is <em>rewritten</em> when a launch sells out early — core pulls it
          forward to the fill block so the pool seeds at that block&apos;s
          end-of-block phase. On a closed record the field is the settlement
          block, not the original deadline. Countdown UIs are only meaningful
          while status is <code className="rounded bg-gray-100 px-1">open</code>.
          The composed value survives in the append-only event history:{" "}
          <code className="rounded bg-gray-100 px-1">
            GET /v2/transactions/&lt;tx_hash&gt;/events/NEW_FAIRMINTER
          </code>{" "}
          returns the original bindings (the rewrite is a separate{" "}
          <code className="rounded bg-gray-100 px-1">FAIRMINTER_UPDATE</code>{" "}
          event), which is how this site verifies the exact window for closed
          launches.
        </p>
      </section>

      <section id="reference-launch" className="space-y-3">
        <h2 className="text-xl font-bold">Reference launch</h2>
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600">
          Fairmint pools activated on 2026-08-05 and no XCP-69 launch exists
          yet. The first launch will be linked here as the reference token —
          the canonical record to validate your integration against: its
          fairminter row should pass the predicate above, its mint tape should
          show ≥{XCP69_MIN_PARTICIPANTS} distinct addresses, and its pool row
          should show the burned LP at the unspendable address.
        </div>
      </section>

      <section id="support-and-terms" className="space-y-3">
        <h2 className="text-xl font-bold">Support & terms</h2>
        <p className="text-sm text-gray-700">
          All data shown on this site is public on-chain data; anything you
          see here you can verify yourself against a Counterparty node. The
          site is an interface, not a counterparty to any transaction — it
          never holds funds and cannot reverse, expedite, or refund anything
          (the protocol handles refunds on its own). Nothing here is
          investment advice; tokens launched through XCP-69 can and will lose
          value. Read the{" "}
          <a href="#risk-disclosures" className="text-purple-600 underline">
            risk disclosures
          </a>{" "}
          before minting.
        </p>
      </section>
    </article>
  );
}
