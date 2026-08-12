import type { Metadata } from "next";
import Link from "next/link";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchLaunchStats } from "@/lib/api/launchpad-api";
import { commas } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";
import { XCP69_MIN_PARTICIPANTS, XCP69_RAISE_SATS } from "@/lib/xcp69";

export const metadata: Metadata = {
  title: "Rewards — xcp.fun",
  description:
    "MINTS for every mint, and an XCP bounty for the first three launches to graduate.",
};

export const revalidate = 60;

/* ---------------------------------------------------------------- *
 * Programme terms. One place, so the page and any future payout
 * script read the same numbers rather than two copies that drift.
 * ---------------------------------------------------------------- */

/** Paid per mint transaction, whatever its size. */
const MINTS_PER_MINT = 100;
/** Ceiling on the whole programme: 10,000 x 100 = 1,000,000 MINTS. */
const MINT_CAP = 10_000;
/** The seeded MINTS/XCP pool that prices the reward. */
const POOL_MINTS = 1_000_000;
const POOL_XCP = 1_000;
/** XCP per MINTS implied by the pool ratio. */
const MINTS_PRICE_XCP = POOL_XCP / POOL_MINTS;
/** What a mint transaction costs in Bitcoin fees, measured across every
 *  mint on the site so far. */
const TYPICAL_MINT_FEE_SATS = 273;
const SATS_PER_XCP = 2_446;

const BOUNTIES = [
  { place: "1st", xcp: 300 },
  { place: "2nd", xcp: 200 },
  { place: "3rd", xcp: 100 },
] as const;

const raiseXcp = XCP69_RAISE_SATS / 1e8;

/**
 * Deliberately not in the nav.
 *
 * The page is real and reachable, so it can be linked from a post or a chat
 * when the programme opens — but until then nothing on the site points at
 * it. Publishing and announcing are separate decisions.
 */
export default async function RewardsPage() {
  const height = await fetchBlockHeight().catch(() => 0);
  const stats = await fetchLaunchStats(height).catch(() => null);
  const mintsSoFar = stats?.activity.mints ?? 0;
  const graduated = stats?.counts.graduated ?? 0;
  const remaining = Math.max(0, MINT_CAP - mintsSoFar);
  const rewardXcp = MINTS_PER_MINT * MINTS_PRICE_XCP;
  const feeXcp = TYPICAL_MINT_FEE_SATS / SATS_PER_XCP;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Rewards</h1>
        <p className="mt-1 text-sm text-gray-600">
          Minting costs you a Bitcoin transaction fee. We pay it back in
          MINTS — and there is an XCP bounty for the first three launches to
          make it all the way.
        </p>
      </div>

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

      {/* ---------------- the bounty ---------------- */}
      <section>
        <h2 className="text-lg font-bold">The graduation bounty</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          No XCP-69 launch has graduated yet. The first three to do it earn
          their creator an XCP bounty on top of the {commas(raiseXcp)} XCP the
          launch itself raises.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th scope="col" className={`px-4 py-2.5 ${LABEL}`}>
                  Place
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  Bounty
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  On top of the raise
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {BOUNTIES.map((b, i) => {
                const claimed = graduated > i;
                return (
                  <tr key={b.place}>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {b.place} to graduate
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">
                      {commas(b.xcp)} XCP
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      +{Math.round((b.xcp / raiseXcp) * 100)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      {claimed ? (
                        <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                          claimed
                        </span>
                      ) : (
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
                          unclaimed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-gray-500">
          Graduating means selling out: {commas(raiseXcp)} XCP raised from at
          least {XCP69_MIN_PARTICIPANTS} different addresses, at which point
          the pool is created and its liquidity is burned. A launch that misses
          its target refunds every satoshi by consensus and does not count.{" "}
          <Link href="/faq" className="text-purple-600 hover:underline">
            How that works
          </Link>
        </p>
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
