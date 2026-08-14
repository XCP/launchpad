import type { Metadata } from "next";
import Link from "next/link";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchLaunchStats, fetchMinterEarnings } from "@/lib/api/launchpad-api";
import { commas, fromSats, shortAddress } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";
import { XCP69_MIN_PARTICIPANTS, XCP69_RAISE_SATS } from "@/lib/xcp69";
import {
  BOUNTIES,
  MINT_CAP,
  MINTS_PER_MINT,
  MINTS_PRICE_XCP,
  POOL_MINTS,
  POOL_XCP,
  SATS_PER_XCP,
  TYPICAL_MINT_FEE_SATS,
  mintsEarned,
} from "@/lib/rewards";

export const metadata: Metadata = {
  title: "XCP Rewards — xcp.fun",
  description:
    "An XCP bounty for the first three launches to graduate, and MINTS for every mint.",
};

export const revalidate = 60;

const raiseXcp = XCP69_RAISE_SATS / 1e8;

/**
 * Not in the nav — the header's green rewards chip is the one pointer to
 * this page, beside the mempool chip.
 */
export default async function RewardsPage() {
  const height = await fetchBlockHeight().catch(() => 0);
  const [stats, earners] = await Promise.all([
    fetchLaunchStats(height).catch(() => null),
    fetchMinterEarnings(25).catch(() => []),
  ]);
  const mintsSoFar = stats?.activity.mints ?? 0;
  const graduated = stats?.counts.graduated ?? 0;
  const remaining = Math.max(0, MINT_CAP - mintsSoFar);
  const rewardXcp = MINTS_PER_MINT * MINTS_PRICE_XCP;
  const feeXcp = TYPICAL_MINT_FEE_SATS / SATS_PER_XCP;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold">XCP Rewards</h1>
        <p className="mt-1 text-sm text-gray-600">
          The first three launches to graduate earn their creator an XCP
          bounty. And every mint along the way earns MINTS.
        </p>
      </div>

      {/* ---------------- the bounty ---------------- */}
      <section>
        <h2 className="text-lg font-bold">The graduation bounty</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          {graduated === 0
            ? "No XCP-69 launch has graduated yet. The first three to do it earn a bounty."
            : graduated === 1
              ? "One bounty is claimed — two are still open for the next launches to graduate."
              : graduated === 2
                ? "Two bounties are claimed — one is still open for the next launch to graduate."
                : "All three bounties have been claimed."}
        </p>

        <Podium graduated={graduated} />

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          Graduating means selling out: {commas(raiseXcp)} XCP raised from at
          least {XCP69_MIN_PARTICIPANTS} different addresses, at which point
          the pool is created and its liquidity is burned. A launch that misses
          its target refunds every satoshi by consensus and does not count.{" "}
          <Link href="/faq" className="text-purple-600 hover:underline">
            How that works
          </Link>
        </p>
      </section>

      {/* ---------------- the ongoing reward ---------------- */}
      <section>
        <h2 className="text-lg font-bold">{commas(MINTS_PER_MINT)} MINTS for every mint</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Mint any XCP-69 launch and earn {commas(MINTS_PER_MINT)} MINTS. It
          doesn&apos;t matter which launch, and it doesn&apos;t matter how much
          you mint — one transaction, one reward. The first{" "}
          {commas(MINT_CAP)} mints are covered.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Per mint" value={`${commas(MINTS_PER_MINT)} MINTS`} hint="one transaction" />
          <Stat
            label="Worth"
            value={`${rewardXcp.toFixed(2)} XCP`}
            hint="at the pool price"
          />
          <Stat
            label="Your fee"
            value={`~${TYPICAL_MINT_FEE_SATS} sats`}
            hint={`~${feeXcp.toFixed(2)} XCP, typical`}
          />
          <Stat
            label="Covered"
            value={`${Math.round((rewardXcp / feeXcp) * 100)}%`}
            hint="of what a mint costs you"
          />
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>Mints so far</span>
            <span className="text-xs text-gray-400 tabular-nums">
              {commas(mintsSoFar)} of {commas(MINT_CAP)}
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: `${Math.min(100, (mintsSoFar / MINT_CAP) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500 tabular-nums">
            {commas(remaining)} still to claim
          </p>
        </div>
      </section>

      {/* ---------------- who has earned what ---------------- */}
      <section>
        <h2 className="text-lg font-bold">Earned so far</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Every mint on a conforming launch, counted. Ranked by mints, because
          that is the unit the reward is paid in.
        </p>

        {earners.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            Nobody has minted yet. The first row here is available.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th scope="col" className={`px-4 py-2.5 ${LABEL}`}>
                    Minter
                  </th>
                  <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                    Mints
                  </th>
                  <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                    Launches
                  </th>
                  <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                    Committed
                  </th>
                  <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                    Earned
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {earners.map((m, i) => (
                  <tr key={m.source} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="mr-2 text-xs text-gray-400 tabular-nums">{i + 1}</span>
                      <Link
                        href={`/profile/${m.source}`}
                        className="font-mono text-xs text-gray-600 hover:text-purple-700"
                      >
                        {shortAddress(m.source)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {commas(m.mints)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      {commas(m.launches)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      {commas(fromSats(m.paid))} XCP
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">
                      {commas(mintsEarned(m.mints))}
                      <span className="ml-1 text-[11px] font-normal text-gray-400">MINTS</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- the small print ---------------- */}
      <section>
        <h2 className={`mb-3 ${LABEL}`}>How it works</h2>
        <dl className="space-y-3 text-sm leading-relaxed text-gray-600">
          <Term term="What MINTS is">
            A Counterparty asset with a fixed, locked supply of 100,000,000 —
            no more can ever be issued. It was itself a free fairminter, minted
            out by 1,376 people. A{" "}
            {commas(POOL_MINTS)} MINTS / {commas(POOL_XCP)} XCP pool sets the
            price at {MINTS_PRICE_XCP} XCP each, so{" "}
            {commas(MINTS_PER_MINT)} MINTS is {rewardXcp.toFixed(2)} XCP.
          </Term>
          <Term term="Why per transaction, not per token">
            The Bitcoin fee you pay is per transaction, so the reward is too.
            Minting one lot and minting the full 1% cost you the same fee and
            earn the same {commas(MINTS_PER_MINT)} MINTS — there is nothing to
            gain by splitting a mint into smaller pieces.
          </Term>
          <Term term="When you get paid">
            Rewards accrue as you mint and are sent out in batches. Nothing
            expires; the count above is what is left of the programme.
          </Term>
          <Term term="The XCP you commit is not a cost">
            A mint escrows XCP against the launch. If it graduates you hold the
            tokens; if it refunds you get every satoshi back. The only thing a
            mint actually costs you is the Bitcoin fee — which is the part this
            programme covers.
          </Term>
        </dl>
      </section>
    </div>
  );
}

/**
 * The three bounties as a podium.
 *
 * Ordered 2nd–1st–3rd left to right, the way a real podium stands, with the
 * step heights carrying the prize sizes. It reads as a race rather than a
 * price list — which is the point while bounties are open: the whole thing
 * is an invitation to take the next step.
 */
function Podium({ graduated }: { graduated: number }) {
  // Visual order, not rank order.
  const layout = [
    { i: 1, height: "h-20", accent: "from-gray-300 to-gray-200", ring: "ring-gray-300" },
    { i: 0, height: "h-28", accent: "from-amber-300 to-amber-200", ring: "ring-amber-400" },
    { i: 2, height: "h-14", accent: "from-orange-300/70 to-orange-200/70", ring: "ring-orange-300" },
  ];

  return (
    <div className="mt-5 grid grid-cols-3 items-end gap-2 sm:gap-4">
      {layout.map(({ i, height, accent, ring }) => {
        const b = BOUNTIES[i]!;
        const claimed = graduated > i;
        return (
          <div key={b.place} className="flex flex-col items-center">
            <div
              className={`mb-2 flex size-9 items-center justify-center rounded-full bg-white text-sm font-bold text-gray-700 ring-2 ${ring}`}
            >
              {i + 1}
            </div>
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums text-gray-900 sm:text-xl">
                {commas(b.xcp)}
              </div>
              <div className={LABEL}>XCP</div>
            </div>
            {/* The step. Height encodes the prize; the label sits inside it. */}
            <div
              className={`mt-2 flex w-full ${height} items-start justify-center rounded-t-xl bg-gradient-to-b ${accent} pt-2`}
            >
              {claimed ? (
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  claimed
                </span>
              ) : (
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  open
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 truncate text-xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-gray-400">{hint}</div>
    </div>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-gray-900">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
