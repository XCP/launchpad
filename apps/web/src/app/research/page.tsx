import type { Metadata } from "next";
import Link from "next/link";
import { ExitRaceSimulator } from "@/app/research/_components/exit-race-simulator";
import {
  coordinatedFirstExitPnlXcp,
  sequentialSellerProceedsXcp,
  totalSequentialExitProceedsXcp,
} from "@/app/research/_lib/economics";
import { METADATA_ORIGIN } from "@/lib/metadata";

const title = "69 addresses, an unknown number of people — xcp.fun";
const description =
  "Exact XCP-69 pool math, Bitcoin fee assumptions, conditional crowding, and observed launch behavior—without pretending addresses are people.";

export const metadata: Metadata = {
  metadataBase: new URL(METADATA_ORIGIN),
  title,
  description,
  alternates: { canonical: METADATA_ORIGIN + "/research" },
  openGraph: {
    type: "article",
    url: METADATA_ORIGIN + "/research",
    siteName: "xcp.fun",
    title,
    description,
    publishedTime: "2026-08-21T12:00:00-04:00",
    modifiedTime: "2026-08-21T12:00:00-04:00",
  },
  twitter: { card: "summary_large_image", title, description },
};

const XCP_USD = 1.7928632703560288;
const BTC_USD = 73_943.04;
const SNAPSHOT_BLOCK = 963_462;

const exitRows = [1, 10, 15, 16, 30, 69].map((position) => {
  const proceeds = sequentialSellerProceedsXcp(position);
  return { position, proceeds, pnl: proceeds - 10 };
});

const fullExit = totalSequentialExitProceedsXcp();
const toc = [
  ["#simulator", "Interactive model"],
  ["#multiple-actors", "More than one actor"],
  ["#observed", "What has happened so far"],
  ["#fees-and-crowding", "Fees and crowding"],
  ["#method", "Method and limitations"],
  ["#cooperation", "Making cooperation easier"],
] as const;

export default function ResearchPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-purple-600">
          XCP-69 research note · August 21, 2026
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          69 addresses, an unknown number of people
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-gray-600">
          What XCP-69 guarantees, what CAPTAINDAN&apos;s public tape shows,
          and why the opening premium becomes an exit queue.
        </p>
      </header>

      <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
        <strong>Production snapshot:</strong> Bitcoin block{" "}
        {SNAPSHOT_BLOCK.toLocaleString()}, mined August 21, 2026 at 16:00:48 UTC.
        USD conversions freeze XCP at $1.792863 and BTC at $73,943.04. The
        examples are mechanism stress tests, not claims that any person
        controlled the hypothetical wallets.
      </aside>

      <section className="holo-border rounded-xl p-5 sm:p-6">
        <h2 className="font-bold">The short version</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-700">
          <li>
            XCP-69 guarantees at least 69 minting addresses. It does not
            guarantee 69 independent people.
          </li>
          <li>
            If other participants fund the rest of the launch, a coordinated
            15.2M allocation has the best theoretical first-exit surplus:
            about +74.25 XCP before Bitcoin fees.
          </li>
          <li>
            That is an upper bound, not evidence of one controller. Independent
            minters can produce the same pool path while dividing its gains
            according to transaction order.
          </li>
          <li>
            If all 69 full bags sell consecutively, average recovery is only{" "}
            {(fullExit / 69).toFixed(2)} XCP per 10 XCP mint.
          </li>
          <li>
            One entity minting and liquidating all 69M loses about{" "}
            {Math.abs(coordinatedFirstExitPnlXcp(69)).toFixed(0)} XCP before
            network costs.
          </li>
        </ul>
      </section>

      <nav aria-label="On this page" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          On this page
        </h2>
        <ul className="mt-2 grid gap-x-4 gap-y-1 text-sm font-medium sm:grid-cols-2">
          {toc.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="text-gray-700 hover:text-purple-600">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <ExitRaceSimulator
        xcpUsd={XCP_USD}
        btcUsd={BTC_USD}
        priceContext="frozen August 21 research snapshot"
      />

      <section id="multiple-actors" className="scroll-mt-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold">What changes when it is more than one actor?</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            The pool cannot identify people. It processes an ordered list of
            trades. Identity matters because it determines who owns the good
            and bad positions in that list, and whether those positions can be
            coordinated.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <dl className="divide-y divide-gray-100 text-sm">
            <ModelFact
              term="Market path"
              detail="Trade size, direction, and order—not wallet labels."
            />
            <ModelFact
              term="Who captures the rent"
              detail="Whoever gets the earliest sales, coordinated or not."
            />
            <ModelFact
              term="Entity evidence"
              detail="Funding, transfers, consolidation, and verified links—not the curve alone."
            />
          </dl>
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          A coalition that minted 20M while other participants funded the
          remaining 49M can realize about +69.76 XCP if it exits first. But 20
          independent bags randomly interleaved among 69 eventual sellers have
          the market-wide expected recovery instead: about 6.88 XCP per bag
          before their own fees. Coordination and ordering create the
          difference.
        </p>

        <div className="rounded-xl bg-gray-900 p-4 text-gray-100">
          <p className="overflow-x-auto whitespace-nowrap font-mono text-xs sm:text-sm">
            first-exit surplus(q) = 690 × (0.995q ÷ (31 + 0.995q)) − 10q
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            q is millions of tokens minted and sold. This upper bound assumes
            other participants funded the rest of the 69M launch and that no
            trade reaches the pool first. It is not whole-actor profit for
            someone who paid for all 69M.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="px-4 pb-2 pt-4 text-left font-semibold text-gray-900">
              One-million-token sellers, with no buys between them
            </caption>
            <thead className="border-b border-gray-100 text-xs text-gray-400">
              <tr>
                <th className="px-4 py-2 font-medium">Exit position</th>
                <th className="px-4 py-2 text-right font-medium">XCP received</th>
                <th className="px-4 py-2 text-right font-medium">vs. mint cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {exitRows.map((row) => (
                <tr key={row.position}>
                  <td className="px-4 py-2.5">{ordinal(row.position)}</td>
                  <td className="px-4 py-2.5 text-right">{row.proceeds.toFixed(2)}</td>
                  <td
                    className={
                      "px-4 py-2.5 text-right font-medium " +
                      (row.pnl >= 0 ? "text-green-700" : "text-red-600")
                    }
                  >
                    {row.pnl >= 0 ? "+" : ""}
                    {row.pnl.toFixed(2)} XCP
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs leading-relaxed text-gray-400">
          Pure-pool sequence, excluding the order book and outside buyers. A
          higher miner fee may improve confirmation priority; it does not
          guarantee an exact position within a block.
        </p>
      </section>

      <section id="observed" className="scroll-mt-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold">CAPTAINDAN: what the chain shows</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            These are address-level observations through the cutoff block, not
            an identity verdict. Buyer and seller sets may overlap and must not
            be added together as people.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Observation value="82" label="raw minting addresses" />
          <Observation value="61" label="addresses at the full 1M cap" />
          <Observation value="29 / 19" label="seller / buyer addresses" />
          <Observation value="528 / 739" label="aggressive sell / buy XCP" />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-700">
          <p>
            CAPTAINDAN recorded 39 aggressive sell transactions totaling
            528.06 XCP and 19 aggressive buy transactions totaling 738.58 XCP.
            “More sellers than buyers” was true by count and incomplete by
            capital flow.
          </p>
          <p className="mt-3">
            Seller-role addresses had minted 22.15M and sold 12.364M. Fourteen
            addresses sold at least 99% of the quantity minted at that same
            address. This is consistent with the exit-race incentive; it does
            not prove coordination.
          </p>
          <p className="mt-3">
            One three-address common-control group was participant-disclosed.
            Merging only that group turns 82 addresses into 80 known address
            clusters—an upper bound on distinct controllers, not an estimate.
            The current index lacks the complete Bitcoin funding graph needed
            to substantiate a “one person minted 20M” claim.
          </p>
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          Across the snapshot, 99 of 163 raw minting addresses joined at least
          two launches and accounted for 87.5% of committed XCP. This shows
          recurrent address-level participation, not how many humans took part.
        </p>
      </section>

      <section id="fees-and-crowding" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-bold">Bitcoin fees reduce the edge; they do not erase it</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          Across 607 conforming mint transactions, the median observed fee was
          232 sats and P90 was 697 sats. CAPTAINDAN&apos;s 107 mint
          transactions had a 231-sat median. These measurements cover mint
          transactions only. They exclude address funding, XCP acquisition and
          transfer, consolidation, sale transactions, replacements, spreads,
          and escrow opportunity cost.
        </p>

        <div className="rounded-xl bg-gray-900 p-4 font-mono text-xs leading-relaxed text-gray-100 sm:text-sm">
          BTC overhead in XCP = (sats ÷ 100,000,000 × BTC/USD) ÷ XCP/USD
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          One maximum-mint address consumes 1M / 69M = 1.449% of the public
          allocation. Twenty maximum addresses consume 28.99%, leaving 49M.
          If valid demand exceeds 69M, they can occupy up to twenty allocations
          later participants otherwise might have received. If demand remains
          below 69M, nobody is displaced; those same allocations may be pivotal
          to graduation.
        </p>
      </section>

      <section id="method" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-bold">Method and limitations</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-gray-700">
          <li>
            Start from the fixed{" "}
            <External href="https://github.com/XCP/launchpad/blob/main/docs/xcp-69.md">
              XCP-69 parameters
            </External>{" "}
            and Counterparty&apos;s exact integer{" "}
            <External href="https://github.com/CounterpartyXCP/counterparty-core/blob/67e10db/counterparty-core/counterpartycore/lib/ledger/markets.py#L19-L32">
              pool-output formula
            </External>.
          </li>
          <li>
            Apply trades to reserves transaction by transaction. The
            first-exit curve is a deterministic stress bound, not a fitted
            forecast.
          </li>
          <li>
            Vary controlled allocation, prior selling, liquidation share,
            Bitcoin overhead, and transaction order.
          </li>
          <li>
            Use production events to calibrate interpretation while keeping
            entity clustering separate and confidence-labeled.
          </li>
        </ol>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
          Three graduated launches identify the mechanics and describe early
          behavior. They do not estimate a stable behavioral equilibrium.
          External demand, book liquidity, transfers, timing, and token utility
          remain scenario inputs.
        </div>

        <div className="space-y-3 text-sm leading-relaxed text-gray-700">
          <p>
            “Prisoner&apos;s dilemma” is useful shorthand, but this is closer
            to a dynamic preemption and common-pool withdrawal game with
            run-like coordination. Relevant primary work includes{" "}
            <External href="https://academic.oup.com/restud/article-abstract/52/3/383/1521386">
              Fudenberg–Tirole on preemption
            </External>,{" "}
            <External href="https://doi.org/10.1086/261155">
              Diamond–Dybvig on runs
            </External>, and{" "}
            <External href="https://www.microsoft.com/en-us/research/publication/the-sybil-attack/">
              Douceur on cheap identities
            </External>.
          </p>
          <p>
            Visible history can matter in a repeated game only when behavior
            is observable and participants value future interactions. It does
            not follow that a badge creates cooperation. See{" "}
            <External href="https://scholar.harvard.edu/files/maskin/files/folk_theorem_in_repeated_games_with_discounting_or_incomplete_information.pdf">
              Fudenberg–Maskin
            </External>.
          </p>
        </div>
      </section>

      <section id="cooperation" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-bold">Make cooperation easier by making behavior legible</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          The first product step should be factual history, not a moral score:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-700">
          <li>“New to XCP-69 at mint time,” scoped precisely and preserved historically.</li>
          <li>Launches joined, XCP committed, and graduated/refunded participation.</li>
          <li>Mint allocation sold within 1 hour, 24 hours, and lifetime.</li>
          <li>XCP spent buying versus received selling; transfers kept separate.</li>
          <li>Connected-address evidence with a confidence level and explanation.</li>
        </ul>
        <p className="text-sm leading-relaxed text-gray-700">
          Avoid one opaque reputation score, permanent “dumper” labels, rewards
          per address, or unverifiable hold promises. Optional signed profiles
          and verifiable timelocks can carry real history or commitment. A
          flashing “only N sellers can still profit” countdown may accelerate
          the run it describes.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 text-xs leading-relaxed text-gray-500">
        <h2 className="font-semibold text-gray-700">Disclosure</h2>
        <p className="mt-2">
          xcp.fun defines and promotes XCP-69 and operates the index used for
          this analysis. Its operator has participated in XCP-69 mints and
          disclosed the three-address cluster used to validate the limits of
          address heuristics. No claim of wash trading, manipulation, insider
          activity, or issuer control is made here.
        </p>
      </section>

      <footer className="border-t border-gray-200 pt-6 text-xs leading-relaxed text-gray-400">
        Published August 21, 2026. Protocol calculations are deterministic;
        observations are a dated production snapshot. This is not investment
        advice. Corrections are welcome in the{" "}
        <a
          href="https://t.me/xcpfun"
          target="_blank"
          rel="noreferrer"
          className="text-purple-600 hover:underline"
        >
          xcp.fun Telegram
        </a>
        .{" "}
        <Link href="/faq" className="text-purple-600 hover:underline">
          Read how XCP-69 works
        </Link>
        .
      </footer>
    </article>
  );
}

function ModelFact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="font-semibold">{term}</dt>
      <dd className="text-gray-600">{detail}</dd>
    </div>
  );
}

function Observation({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold tabular-nums text-gray-900">{value}</div>
      <div className="mt-1 text-xs leading-snug text-gray-500">{label}</div>
    </div>
  );
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-purple-600 underline"
    >
      {children}
    </a>
  );
}

function ordinal(value: number) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return value + "th";
  if (value % 10 === 1) return value + "st";
  if (value % 10 === 2) return value + "nd";
  if (value % 10 === 3) return value + "rd";
  return value + "th";
}
