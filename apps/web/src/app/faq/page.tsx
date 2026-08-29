import Link from "next/link";
import { fetchXcpUsd } from "@/lib/api/price";
import {
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
} from "@/lib/xcp69";
import { StandardPlayground } from "@/app/faq/_components/explainer";

export const metadata = {
  title: "How it works — xcp.fun",
  description:
    "One fixed parameter set for token launches on Counterparty: the launch sells out and liquidity locks forever, or everyone is refunded. Zero creator take, enforced by consensus.",
};

const PARAMS: [string, string][] = [
  ["Supply", "100,000,000 — locked at close"],
  ["Public sale", "69,000,000 (the soft cap IS the whole sale)"],
  ["Pool reserve", "31,000,000"],
  ["Price", "0.01 XCP per 1,000-token lot"],
  ["Per-address cap", "1,000,000 tokens (10 XCP)"],
  ["Start", "a future block — announced on-chain before minting can open"],
  ["Mint window", "exactly 1,000 blocks (~7 days) from start"],
  ["Premine / commission", "none — the creator mints like everyone else"],
  ["Asset", "named assets only, divisible"],
];

export default async function StandardPage() {
  const xcpUsd = await fetchXcpUsd();
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Mints out, or your XCP back.</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          A new way to launch a coin on Counterparty — every launch identical,
          enforced by consensus.
        </p>
      </div>

      <section className="holo-border rounded-xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-bold">The XCP-69 standard</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            guaranteed by consensus, not this website
          </span>
        </div>
        <ul className="mt-4 grid gap-x-6 gap-y-3 text-sm font-medium text-gray-800 dark:text-gray-200 sm:grid-cols-2">
          <li className="flex items-center gap-2.5">
            <span aria-hidden>⚖️</span>Mints out, or full refund
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>🔒</span>Liquidity locked forever
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>🚫</span>No platform, no creator fees
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>👥</span>
            {XCP69_MIN_PARTICIPANTS}+ addresses to sell out
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>📢</span>Announced before minting opens
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>📈</span>Opens at{" "}
            {XCP69_OPENING_MULTIPLE.toFixed(2)}× mint price
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-bold">Feel the mechanism</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          The whole standard, hands-on — starting, like every launch, with the
          mint.
        </p>
        <StandardPlayground xcpUsd={xcpUsd}>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <h3 className="font-semibold">3 · All coins are the same</h3>
              <div className="text-right">
                <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">0</span>
                <span className="text-sm text-gray-400 dark:text-gray-500"> gotchas</span>
              </div>
            </div>
            <dl className="mt-3 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              {PARAMS.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              No slider on this one — there is nothing to configure. Every
              launch is identical, checked field-by-field against the on-chain
              record.
            </p>
          </div>
        </StandardPlayground>
      </section>

      <section>
        <h2 className="mb-2 font-bold">FAQ</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          The honest questions — including the ones that don&apos;t flatter us.
        </p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <details className="group p-4" open>
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              What do I actually lose if a launch fails?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Your Bitcoin transaction fee — that&apos;s it. Every satoshi of
              XCP you minted with comes back automatically; the protocol has
              no other outcome. Think of the fee as cheap insurance: you&apos;d
              much rather pay one transaction fee and get your XCP back than
              be out both, which is the normal ending on launchpads where a
              half-filled launch just trades into the floor.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Where do I get the XCP to mint with?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Minting is paid in XCP on your address&apos;s Counterparty
              balance — BTC only covers miner fees. The fastest no-account
              route is an on-chain dispenser: send BTC, the protocol vends
              XCP automatically.{" "}
              <Link href="/dispense" className="text-purple-600 dark:text-purple-400 underline">
                Buy from the cheapest dispensers here
              </Link>
              . A max mint is 10 XCP; a launch needs 0.5 XCP for the name.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              What happens to the token itself if a launch fails?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              It ceases to exist — permanently. At the deadline, consensus
              destroys every minted token out of protocol escrow (they never
              touched anyone&apos;s wallet), refunds every minter&apos;s XCP,
              and closes the asset locked at zero supply. Nothing lingers in
              any wallet: no frozen tokens, no dust — minters end
              bit-identical to never having participated, minus one miner
              fee. The name itself becomes a tombstone: registered forever,
              mintable never. Worth weighing if you launch with a name you
              already own — a failed launch buries the name with the launch.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Can I launch on a token name that already exists?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Yes — and a name with history is a feature. But only the name
              comes along: consensus requires <em>zero existing supply</em> at
              launch (the all-or-nothing equation only balances at zero), so
              even a decade-old name starts with a clean cap table — the 69M +
              31M minted at launch is all the supply that has ever existed.
              You must be the asset&apos;s current issuer, it must be
              unlocked, and it must already be divisible. If it carries
              supply, destroy every unit first — and supply in other
              people&apos;s hands can&apos;t be destroyed, which permanently
              disqualifies the name. There is no grandfathering old holders;
              that would be a premine with extra steps.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Are all Counterparty fairminters like this?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              No — and that&apos;s the point. The fairminter protocol allows
              enormous variation: no soft cap, no refunds, creator
              commissions up to 99%, premines, no pool at all. XCP-69 pins
              one configuration of it, and this site lists only launches that
              match the standard exactly, checked field-by-field against the
              on-chain record. Here, every launch behaves identically and you
              never audit the parameters yourself. A fairminter you encounter
              anywhere else carries no such guarantee — read its fields
              before you mint.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Can someone fake the crowd?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Partially. The 10 XCP per-address cap makes a fake crowd cost at
              least 69 funded addresses — it raises the price of the act, it
              cannot prevent it. Sybil-resistant in cost, not in principle.
              The mint tape, address histories, and holder spread are all
              public, so a manufactured crowd has to fake those too.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Does a refund make me whole?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              In XCP terms, exactly. In fiat terms, only if XCP&apos;s price
              held during the ~week-long window. Refunds return quantity, not
              value.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Is the {XCP69_OPENING_MULTIPLE.toFixed(2)}× opening premium a
              price guarantee?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              No — it&apos;s structural, not promised. The pool must open at
              69/31 of mint price because those are the only quantities that
              exist, but the floor decays as people sell into it. Nothing
              stops a token trading below mint. What the pool guarantees is a
              bid that never reaches zero, not a bid you&apos;ll like.
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              Where does the token art actually live?
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Off-chain by default: the chain permanently carries the URL of
              the asset-info JSON, and the content behind it is curatable by
              the asset&apos;s current owner (wallet-signature gated). Taproot
              creators can instead inscribe the image on-chain as the
              permanent description — no off-chain dependency at all. Either
              way, nothing economic depends on hosted content.
            </p>
          </details>
        </div>
      </section>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Full specification with raw compose values and the conformance
        predicate:{" "}
        <a
          href="https://github.com/XCP/launchpad/blob/main/docs/xcp-69.md"
          className="text-purple-600 dark:text-purple-400 underline"
          target="_blank"
          rel="noreferrer"
        >
          docs/xcp-69.md
        </a>
        . Conformance is checked field-by-field on-chain — this site lists only
        launches that match exactly.
      </p>
    </article>
  );
}
