import {
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
} from "@/lib/xcp69";

export const metadata = { title: "The XCP-69 Standard — xcp.fun" };

const PARAMS: [string, string][] = [
  ["Supply", "100,000,000 — locked at close"],
  ["Public sale", "69,000,000 (the soft cap IS the whole sale)"],
  ["Pool reserve", "31,000,000"],
  ["Price", "0.1 XCP per 1,000-token lot"],
  ["Per-address cap", "690,000 tokens (1% of sale · 69 XCP)"],
  ["Mint window", "1,000 blocks (~7 days)"],
  ["Premine / commission", "none — the creator mints like everyone else"],
  ["Asset", "named assets only, divisible"],
];

export default function StandardPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">The XCP-69 Standard</h1>
        <p className="mt-2 text-gray-600">
          One fixed parameter set for token launches on Counterparty fairmint
          pools. Every launch on this site is identical — there is nothing to
          read in the fine print, because there is no fine print.
        </p>
      </div>

      <section className="holo-border rounded-xl p-6">
        <h2 className="font-bold">What the protocol guarantees</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>All-or-nothing.</strong> The launch sells out its 69M public
            sale within 1,000 blocks, or the protocol refunds every minter
            automatically and destroys the supply.
          </li>
          <li>
            <strong>The creator receives none of the raised XCP.</strong> All
            6,900 XCP goes into the TOKEN/XCP pool at close.
          </li>
          <li>
            <strong>Liquidity is locked forever.</strong> The pool&apos;s LP
            tokens are minted to the unspendable address. A rug pull is not
            mitigated — it is unavailable.
          </li>
          <li>
            <strong>At least {XCP69_MIN_PARTICIPANTS} participants.</strong>{" "}
            The 1% per-address cap makes the soft cap unreachable without a
            real crowd.
          </li>
          <li>
            <strong>
              The pool opens at {XCP69_OPENING_MULTIPLE.toFixed(2)}× mint
              price.
            </strong>{" "}
            Every minter is structurally in profit at open; the pool absorbs
            early exits.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-bold">Parameters</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <dl className="divide-y divide-gray-100 text-sm">
            {PARAMS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Honest limitations</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            The per-address cap raises the cost of faking a crowd; it cannot
            prevent one. It is sybil-resistant in cost, not in principle.
          </li>
          <li>Refunds return your XCP quantity, not its fiat value.</li>
          <li>
            The {XCP69_OPENING_MULTIPLE.toFixed(2)}× opening premium is
            structural, not a price guarantee — the pool floor decays as people
            sell into it.
          </li>
          <li>
            Token image and description are hosted off-chain; the chain carries
            their URL, permanently.
          </li>
        </ul>
      </section>

      <p className="text-sm text-gray-500">
        Full specification with raw compose values and the conformance
        predicate:{" "}
        <a
          href="https://github.com/XCP/launchpad/blob/main/docs/xcp-69.md"
          className="text-purple-600 underline"
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
