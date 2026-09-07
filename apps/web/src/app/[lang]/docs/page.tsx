import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLocale } from "@/lib/i18n/locales";
import { rich } from "@/lib/i18n/rich";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages, getT } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import { LazyLink } from "@/components/lazy-link";
import {
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
} from "@/lib/xcp69";
import { CopyDocsButton } from "@/app/[lang]/docs/_components/copy-button";
import { docsMarkdown } from "@/app/[lang]/docs/_lib/docs-markdown";
import {
  COMPOSE_LAUNCH_SNIPPET,
  COMPOSE_MINT_SNIPPET,
  CURL_HOLDERS,
  CURL_OPEN_LAUNCHES,
  CURL_POOL,
  EVENTS,
  FEE_ROWS,
  PREDICATE_SNIPPET,
} from "@/app/[lang]/docs/_lib/snippets";

const PAGE_METADATA = {
  title: msg("Docs — xcp.fun"),
  description:
    msg("Everything about XCP-69, in one place: how launches work, how pricing works, what graduation means, what it costs (nothing), and how to integrate."),
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    ...PAGE_METADATA,
    title: t(String(PAGE_METADATA.title)),
    ...(PAGE_METADATA.description ? { description: t(PAGE_METADATA.description) } : {}),
    alternates: localeAlternates(locale, "/docs"),
  };
}

const TOC: { section: string; items: [string, string][] }[] = [
  {
    section: msg("About"),
    items: [
      ["#overview", msg("Overview")],
      ["#launch-mechanism", msg("Launch mechanism")],
      ["#trading-and-pricing", msg("Trading and pricing")],
      ["#graduation", msg("Graduation")],
      ["#fees", msg("Fees")],
      ["#risk-disclosures", msg("Risk disclosures")],
    ],
  },
  {
    section: msg("Integration"),
    items: [
      ["#network", msg("Network")],
      ["#message-format", msg("Message format")],
      ["#composing", msg("Composing transactions")],
      ["#conformance", msg("Conformance")],
      ["#onchain-events", msg("Onchain events")],
      ["#reading-state", msg("Reading state")],
      ["#reference-launch", msg("Reference launch")],
      ["#support-and-terms", msg("Support & terms")],
    ],
  },
];

/** The pricing glossary: term and definition, both translated at render. */
const PRICING_TERMS: [string, string][] = [
  [
    msg("Price"),
    msg("XCP reserve ÷ token reserve. Moves with every swap; there is no order book and no market maker."),
  ],
  [
    msg("Market cap"),
    msg("Pool price × circulating supply (issued minus burned). A convention, not a promise — the pool could not pay it out."),
  ],
  [
    msg("Price impact"),
    msg("How much your own swap moves the price. Larger swaps against the fixed reserves get a worse average price."),
  ],
  [
    msg("Slippage"),
    msg("The difference between the quoted price and what executes, if the pool moves between your quote and your confirmation."),
  ],
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100 dark:border dark:border-gray-800 dark:bg-gray-950">
      <code>{children}</code>
    </pre>
  );
}

/** Inline code as the docs write it. Never translated: these are field
 *  names, statuses and endpoints the reader will type. */
function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-gray-100 dark:bg-gray-800 px-1">{children}</code>;
}

export default async function DocsPage() {
  const t = await getT();
  const mult = XCP69_OPENING_MULTIPLE.toFixed(2);
  const min = XCP69_MIN_PARTICIPANTS;
  const linkClass = "text-purple-600 dark:text-purple-400 underline";
  return (
    <article className="mx-auto max-w-2xl space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("Docs")}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("Everything about XCP-69, in one place. The first half explains how launches work for anyone. The second half is for developers who want to read or build on the same on-chain data this site does.")}
          </p>
        </div>
        <CopyDocsButton markdown={docsMarkdown()} />
      </div>

      <nav className="grid gap-4 sm:grid-cols-2">
        {TOC.map(({ section, items }) => (
          <div
            key={section}
            className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t(section)}
            </h2>
            <ul className="mt-2 space-y-1 text-sm font-medium">
              {items.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="text-gray-700 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400">
                    {t(label)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ---------------------------------------------------------------- */}

      <section id="overview" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Overview")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "XCP-69 is a fixed-parameter token launch standard built on Counterparty {pools}. There is no factory contract, no admin key, and no platform custody at any point: the protocol {is} the platform. Every action — creating a launch, minting, swapping — is a transaction you sign in your own wallet and broadcast to Bitcoin. This site is an interface over public on-chain data; if it disappeared tomorrow, every launch, refund, and pool would keep working exactly as before.",
            { pools: <strong>{t("fairmint pools")}</strong>, is: <em>{t("is")}</em> },
          )}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Every XCP-69 launch is identical: 100M supply, 69M public sale at 0.01 XCP per 1,000-token lot, 31M reserved for the liquidity pool, 10 XCP per-address cap, an on-chain pre-announcement before minting opens, and a 1,000-block window. There is no fine print to read because there is no fine print. The full parameter set lives on the {link} page.",
            {
              link: (
                <LazyLink href="/faq" className={linkClass}>
                  {t("How it works")}
                </LazyLink>
              ),
            },
          )}
        </p>
      </section>

      <section id="launch-mechanism" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Launch mechanism")}</h2>
        <div className="holo-border rounded-xl p-5 text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "{inversion} on most launchpads, trading starts instantly and the crowd arrives later, if ever. XCP-69 flips this — trading cannot begin until the community has fully funded the launch. The 10 XCP per-address cap means the 69M sale is unreachable without at least {n} distinct addresses. By construction, no token trades before a real crowd has paid for it.",
            { inversion: <strong>{t("The inversion:")}</strong>, n: min },
          )}
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t("A launch moves through four phases:")}</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            {rich(
              t,
              "{announce} Every launch confirms on-chain {before} its {startBlock}. Until that block arrives the fairminter is {pending} and consensus rejects every mint — nobody, creator included, can mint early. There are no stealth launches: the full terms sit on-chain, inspectable, before the first lot can be bought.",
              {
                announce: <strong>{t("Announce.")}</strong>,
                before: <em>{t("before")}</em>,
                startBlock: <Code>start_block</Code>,
                pending: <Code>pending</Code>,
              },
            )}
          </li>
          <li>
            {rich(
              t,
              "{mint} A 1,000-block window (~7 days) from {startBlock}. Anyone can mint whole 1,000-token lots at 0.01 XCP per lot, up to 1,000,000 tokens (10 XCP) per address. Both the paid XCP and the minted tokens sit in escrow at the unspendable address — nobody holds anything until the launch resolves. The window length only ever delays failure: a sell-out settles the moment it fills, while a miss frees every minter's XCP within about a week.",
              { mint: <strong>{t("Mint.")}</strong>, startBlock: <Code>start_block</Code> },
            )}
          </li>
          <li>
            {rich(
              t,
              "{resolve} All-or-nothing at the 69M soft cap. The soft cap equals the entire public sale, so reaching it {is} selling out — there is no partial success. Sell out and the pool seeds; miss the deadline and the protocol refunds every minter automatically and destroys the escrowed supply. Resolution happens at end-of-block even on a hard-cap fill, so nobody can trade the pool in the transaction that creates it.",
              { resolve: <strong>{t("Resolve.")}</strong>, is: <em>{t("is")}</em> },
            )}
          </li>
          <li>
            {rich(
              t,
              "{trade} All 690 raised XCP plus the 31M reserved tokens seed a TOKEN/XCP AMM pool. The LP tokens are minted directly to the unspendable address — liquidity is locked by consensus, permanently. Supply and description lock in the same block, and trading is live immediately.",
              { trade: <strong>{t("Trade.")}</strong> },
            )}
          </li>
        </ol>
      </section>

      <section id="trading-and-pricing" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Trading and pricing")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Graduated tokens trade against a constant-product TOKEN/XCP pool. The price is simply the ratio of the pool's reserves; every swap moves it. A fixed {fee} fee on each swap is paid to the pool itself — and since the LP is burned, fees deepen the locked liquidity rather than paying anyone out.",
            { fee: <strong>{t("50 bps")}</strong> },
          )}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("The pool opens with 690 XCP against 31M tokens: 69/31 ≈ {mult}× the mint price. Every minter is structurally in profit at open, and the pool — not later buyers — absorbs early exits.", { mult })}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Counterparty's DEX order is the single trading primitive: matching routes through the pool whenever the pool's price beats the order book. A {market} is an order at the router's quoted output — it fills from pool and book at best price immediately. A {limit} rests on the book, and the pool fills it automatically if its price ever crosses yours.",
            { market: <em>{t("market order")}</em>, limit: <em>{t("limit order")}</em> },
          )}
        </p>
        <dl className="divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm">
          {PRICING_TERMS.map(([term, def]) => (
            <div key={term} className="px-4 py-3">
              <dt className="font-medium">{t(term)}</dt>
              <dd className="mt-0.5 text-gray-600 dark:text-gray-400">{t(def)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="graduation" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Graduation")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "On other launchpads, graduation is a threshold inside a live market: the token trades on a curve while everyone hopes it reaches the magic number. XCP-69 graduation is {binary} and happens before any trading exists. Sell out the 69M sale within 1,000 blocks and the launch graduates — pool seeded, LP burned, supply locked, trading live in the same block's resolution phase. Miss it and the launch never trades at all.",
            { binary: <strong>{t("binary")}</strong> },
          )}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Refunds are not a support process. They are automatic protocol behavior: at the deadline, every minter's XCP is returned and the escrowed supply is destroyed in the same block. Failed launches move to the graveyard, where their history is preserved — the mint tape, the participant count, and the on-chain proof: a destruction record tagged {tag}.",
            { tag: <em>&quot;{t("soft cap not reached")}&quot;</em> },
          )}
        </p>
      </section>

      <section id="fees" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Fees")}</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <dl className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
            {FEE_ROWS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                <dd className="max-w-[55%] text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("There is no fee-split table because there are no fees to split. Every satoshi of XCP paid by minters goes into the pool. The only costs anywhere in the system are Bitcoin transaction fees, the 0.5 XCP asset-name registration fee for named assets, and the protocol's pooldeposit gas fee debited at creation — costs paid to the network, not to us or to the creator.")}
        </p>
      </section>

      <section id="risk-disclosures" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Risk disclosures")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("The standard removes the rug pull and the premine. It does not remove risk, and we won't pretend otherwise:")}
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            {rich(
              t,
              "{claim} The cap is per address, not per person. It raises the cost of faking a crowd of {n}; it cannot prevent one.",
              {
                claim: <strong>{t("The per-address cap is sybil-resistant in cost only, not in principle.")}</strong>,
                n: min,
              },
            )}
          </li>
          <li>
            {rich(
              t,
              "{claim} If XCP's price moves during the ~7-day window, a refund makes you whole in XCP terms only.",
              { claim: <strong>{t("Refunds return XCP quantity, not fiat value.")}</strong> },
            )}
          </li>
          <li>
            {rich(
              t,
              "{claim} The pool floor decays as people sell into it. Nothing stops a token from trading below mint price.",
              {
                claim: (
                  <strong>
                    {t("The {mult}× opening premium is structural, not a price guarantee.", { mult })}
                  </strong>
                ),
              },
            )}
          </li>
          <li>
            {rich(
              t,
              "{claim} By default the chain permanently carries the URL of the asset-info JSON (via {lockDescription}) while the image and info are hosted off-chain, editable only by the asset's current on-chain owner via a wallet-signed message. If that hosting ever vanished, the token's economics — supply, pool, refunds — are untouched; only the artwork would be. Creators launching from a taproot wallet can remove the dependency entirely by inscribing the image on-chain as the permanent description.",
              {
                claim: <strong>{t("Token media is on-chain only if the creator chooses.")}</strong>,
                lockDescription: <Code>lock_description</Code>,
              },
            )}
          </li>
        </ul>
      </section>

      {/* ---------------------------------------------------------------- */}

      <div className="border-t border-gray-200 dark:border-gray-800 pt-8">
        <h2 className="text-2xl font-bold">{t("Integration")}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t("Everything this site displays comes from public APIs. You can build your own launchpad, bot, or dashboard on the same data — nothing below requires our permission.")}
        </p>
      </div>

      <section id="network" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Network")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            {rich(
              t,
              "{label} Counterparty on Bitcoin mainnet. XCP-69 launches are ordinary Bitcoin transactions carrying Counterparty messages.",
              { label: <strong>{t("Chain:")}</strong> },
            )}
          </li>
          <li>
            {rich(t, "{label} {base} — or run your own counterparty-core node for trustless reads.", {
              label: <strong>{t("API base:")}</strong>,
              base: <Code>https://api.counterparty.io:4000/v2</Code>,
            })}
          </li>
          <li>
            {rich(
              t,
              "{label} {feature}, activated on mainnet at block 961,100 (2026-08-05). Requires core v11.2.0+.",
              { label: <strong>{t("Protocol feature:")}</strong>, feature: <Code>fairmint_pool</Code> },
            )}
          </li>
        </ul>
      </section>

      <section id="message-format" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Message format")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Launches use the {fairminter} message (ID 90) with the pool fields {poolQuantity} and {lpAsset} set. Mints are ordinary fairmint messages in whole-lot multiples of {quantityByPrice}.",
            {
              fairminter: <strong>{t("fairminter")}</strong>,
              poolQuantity: <Code>pool_quantity</Code>,
              lpAsset: <Code>lp_asset</Code>,
              quantityByPrice: <Code>quantity_by_price</Code>,
            },
          )}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "One integration trap worth knowing: Counterparty Core 11.3+ returns {poolNormalized} and {maxNormalized} under {verbose}. Use them for display, but keep standard conformance math in raw integer satoshi units (×10⁸) so comparisons remain exact and match non-verbose event and mempool data.",
            {
              poolNormalized: <Code>pool_quantity_normalized</Code>,
              maxNormalized: <Code>max_mint_per_address_normalized</Code>,
              verbose: <Code>verbose=true</Code>,
            },
          )}
        </p>
      </section>

      <section id="composing" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Composing transactions")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "The compose API returns an {unsigned} raw Bitcoin transaction — the node never sees a key. Sign with your own wallet, broadcast, done. Add {verbose} for a PSBT and echoed params; every quantity is a raw integer.",
            { unsigned: <strong>{t("unsigned")}</strong>, verbose: <Code>verbose=true</Code> },
          )}
        </p>
        <CodeBlock>{COMPOSE_LAUNCH_SNIPPET}</CodeBlock>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Consensus enforces the standard's coherence at parse time: {softCap} must equal {formula} whenever {poolQuantity} > 0 — all-or-nothing is a protocol rule, not site policy. The issuer's address must hold the 0.5 XCP name-registration fee plus the pooldeposit gas fee on-ledger; both debit at confirmation, so settlement later costs nothing. Pick {lpAsset} with real randomness: numeric issuance is free, and a predictable name lets anyone pre-register it between broadcast and confirmation, invalidating the launch.",
            {
              softCap: <Code>soft_cap</Code>,
              formula: <Code>hard_cap − premint − pool_quantity</Code>,
              poolQuantity: <Code>pool_quantity</Code>,
              lpAsset: <Code>lp_asset</Code>,
            },
          )}
        </p>
        <CodeBlock>{COMPOSE_MINT_SNIPPET}</CodeBlock>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "Mints must be whole-lot multiples of {quantityByPrice}, within the per-transaction cap, and within the address's remaining allowance — a partially used cap can be topped up across multiple transactions. The minter needs the XCP {onBalance}; a funded BTC wallet with no XCP will compose-fail with {error}.",
            {
              quantityByPrice: <Code>quantity_by_price</Code>,
              onBalance: <em>{t("on their Counterparty balance")}</em>,
              error: <em>&quot;insufficient XCP balance&quot;</em>,
            },
          )}
        </p>
      </section>

      <section id="conformance" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Conformance")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("Core has no on-chain standard marker, so conformance is a predicate: exact equality against the standard's fixed raw values. This is the actual function this site runs — a launch either passes it or is not XCP-69.")}
        </p>
        <CodeBlock>{PREDICATE_SNIPPET}</CodeBlock>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("The commission clause is the one naive checks miss. The protocol allows a fairminter to skim up to 99% of every mint back to the creator — a premine with extra steps — and no other field catches it. XCP-69 requires it to be exactly 0.")}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "The timing clauses are the two deliberate inequalities. Consensus does not require a future start — a launch confirming late simply opens instantly — so the pre-announcement guarantee lives here: {startBlock} must exceed the confirmation block. Without that clause, a creator could broadcast a nominal 1,000-block sale late, confirm just before its own deadline, and run a near-instant insider mint behind thousand-block metadata. And on the fairminter row the window check relaxes to {lte} once closed because core rewrites the deadline on early sell-out — for closed launches this site restores exact equality from the immutable {event} event (see the trap in Reading state). Everything else is exact equality on the row.",
            {
              startBlock: <Code>start_block</Code>,
              lte: <Code>≤</Code>,
              event: <Code>NEW_FAIRMINTER</Code>,
            },
          )}
        </p>
      </section>

      <section id="onchain-events" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Onchain events")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(t, "The full lifecycle is observable as Counterparty events via {endpoint}:", {
            endpoint: <Code>GET /v2/events/&lt;EVENT&gt;</Code>,
          })}
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <dl className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
            {EVENTS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="font-mono text-xs font-medium">{k}</dt>
                <dd className="max-w-[60%] text-right text-gray-600 dark:text-gray-400">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="reading-state" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Reading state")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("Everything is curl-able. Launches and mints:")}
        </p>
        <CodeBlock>{CURL_OPEN_LAUNCHES}</CodeBlock>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t("Pools, prices, and quotes:")}</p>
        <CodeBlock>{CURL_POOL}</CodeBlock>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t("Holders:")}</p>
        <CodeBlock>{CURL_HOLDERS}</CodeBlock>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "{recipe} Success and failure both end at fairminter status {closed}, so the pool row is the disambiguator:",
            { recipe: <strong>{t("Lifecycle detection recipe.")}</strong>, closed: <Code>closed</Code> },
          )}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>{rich(t, "{status} → scheduled", { status: <Code>pending</Code> })}</li>
          <li>{rich(t, "{status} → minting", { status: <Code>open</Code> })}</li>
          <li>
            {rich(t, "{status} + {pool} returns a pool → graduated", {
              status: <Code>closed</Code>,
              pool: <Code>/v2/pools/&lt;ASSET&gt;/XCP</Code>,
            })}
          </li>
          <li>
            {rich(
              t,
              "{status} with no pool row → refunded (corroborate with the destruction tagged \"soft cap not reached\")",
              { status: <Code>closed</Code> },
            )}
          </li>
        </ul>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "{trap} {deadline} is {rewritten} when a launch sells out early — core pulls it forward to the fill block so the pool seeds at that block's end-of-block phase. On a closed record the field is the settlement block, not the original deadline. Countdown UIs are only meaningful while status is {open}. The composed value survives in the append-only event history: {endpoint} returns the original bindings (the rewrite is a separate {update} event), which is how this site verifies the exact window for closed launches.",
            {
              trap: <strong>{t("Second integration trap:")}</strong>,
              deadline: <Code>soft_cap_deadline_block</Code>,
              rewritten: <em>{t("rewritten")}</em>,
              open: <Code>open</Code>,
              endpoint: <Code>GET /v2/transactions/&lt;tx_hash&gt;/events/NEW_FAIRMINTER</Code>,
              update: <Code>FAIRMINTER_UPDATE</Code>,
            },
          )}
        </p>
      </section>

      <section id="reference-launch" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Reference launch")}</h2>
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 text-sm text-gray-600 dark:text-gray-400">
          {t("Fairmint pools activated on 2026-08-05 and no XCP-69 launch exists yet. The first launch will be linked here as the reference token — the canonical record to validate your integration against: its fairminter row should pass the predicate above, its mint tape should show ≥{n} distinct addresses, and its pool row should show the burned LP at the unspendable address.", { n: min })}
        </div>
      </section>

      <section id="support-and-terms" className="space-y-3">
        <h2 className="text-xl font-bold">{t("Support & terms")}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {rich(
            t,
            "All data shown on this site is public on-chain data; anything you see here you can verify yourself against a Counterparty node. The site is an interface, not a counterparty to any transaction — it never holds funds and cannot reverse, expedite, or refund anything (the protocol handles refunds on its own). Nothing here is investment advice; tokens launched through XCP-69 can and will lose value. Read the {link} before minting.",
            {
              link: (
                <a href="#risk-disclosures" className={linkClass}>
                  {t("risk disclosures")}
                </a>
              ),
            },
          )}
        </p>
      </section>
    </article>
  );
}
