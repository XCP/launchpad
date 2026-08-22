import type { Metadata } from "next";
import Link from "next/link";
import { fetchBlockHeight, fetchPool } from "@/lib/api/counterparty";
import { fetchLaunchPage, fetchLaunchStats, fetchMinterEarnings } from "@/lib/api/launchpad-api";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { commas, price as priceFmt } from "@/lib/format";
import { ratio } from "@/lib/numeric";
import { LABEL } from "@/components/ui/tokens";
import { TokenImage } from "@/components/token-image";
import { XCP69_MIN_PARTICIPANTS, XCP69_RAISE_SATS } from "@/lib/xcp69";
import {
  BOUNTIES,
  MINT_CAP,
  MINTS_PER_MINT,
  MINTS_PRICE_XCP,
  SATS_PER_XCP,
  TYPICAL_MINT_FEE_SATS,
} from "@/lib/rewards";
import { EarnersTable } from "@/app/rewards/_components/earners-table";

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
  const [stats, earners, graduates, mintsPool, xcpUsd, btcUsd] = await Promise.all([
    fetchLaunchStats(height).catch(() => null),
    fetchMinterEarnings(25).catch(() => []),
    fetchLaunchPage("graduated", "graduated", 3, 0).catch(() => null),
    // The MINTS/XCP pool is live on-chain; its reserve ratio IS the price.
    // The constant in lib/rewards is the seeded ratio, kept as the fallback
    // so an API hiccup never renders a reward worth zero.
    fetchPool("MINTS").catch(() => null),
    fetchXcpUsd().catch(() => null),
    fetchBtcUsd().catch(() => null),
  ]);
  const mintsSoFar = stats?.activity.mints ?? 0;
  const graduated = stats?.counts.graduated ?? 0;
  const remaining = Math.max(0, MINT_CAP - mintsSoFar);

  // XCP per MINTS from live reserves (both sides are 8-decimal raw, so the
  // raw ratio needs no scale correction). reserve_a/b follow the pool's own
  // asset order, so pick the XCP side by name rather than by position.
  const livePrice = mintsPool
    ? mintsPool.asset_a === "XCP"
      ? ratio(mintsPool.reserve_a, mintsPool.reserve_b)
      : ratio(mintsPool.reserve_b, mintsPool.reserve_a)
    : null;
  const mintsPriceXcp = livePrice && livePrice > 0 ? livePrice : MINTS_PRICE_XCP;
  const rewardXcp = MINTS_PER_MINT * mintsPriceXcp;

  // Sats per XCP from the same feeds the rest of the site prices with; the
  // measured constant stands in only when a feed is down.
  const satsPerXcp =
    btcUsd && xcpUsd && xcpUsd > 0 ? (xcpUsd / btcUsd) * 1e8 : SATS_PER_XCP;
  const feeXcp = TYPICAL_MINT_FEE_SATS / satsPerXcp;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* No page title — the chip that brought you here already said XCP
          Rewards, and the bounty section opens the page. */}
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

        <Podium graduated={graduated} winners={graduates?.rows.map((r) => r.fm.asset) ?? []} />

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
        <div className="flex items-center gap-3">
          <TokenImage
            asset="MINTS"
            className="size-10 shrink-0 rounded-lg object-cover"
          />
          <h2 className="text-lg font-bold">
            {commas(MINTS_PER_MINT)} MINTS for every mint
          </h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Mint any XCP-69 launch and earn {commas(MINTS_PER_MINT)} MINTS. It
          doesn&apos;t matter which launch, and it doesn&apos;t matter how much
          you mint — one transaction, one reward (valid for the first{" "}
          {commas(MINT_CAP)} mint transactions).
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Per mint" value={`${commas(MINTS_PER_MINT)} MINTS`} hint="one transaction" />
          <Stat
            label="Worth"
            value={`${rewardXcp.toFixed(2)} XCP`}
            hint="at the live pool price"
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

        <EarnersTable initial={earners} />
      </section>

      {/* ---------------- the small print, in the site's FAQ grammar ---------------- */}
      <section>
        <h2 className="text-lg font-bold">FAQ</h2>
        <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          <Faq q="What is MINTS?" open>
            The first fairminter ever created on Counterparty — block 866,297,
            before any other, and it minted out free to 1,376 addresses. The
            supply is 100,000,000, locked forever; no more can ever be issued.
            The live MINTS/XCP pool prices the reward: right now 1 MINTS
            trades at {priceFmt(mintsPriceXcp)} XCP, so{" "}
            {commas(MINTS_PER_MINT)} MINTS is {rewardXcp.toFixed(2)} XCP.
          </Faq>
          <Faq q="Why per transaction, not per token?">
            The Bitcoin fee you pay is per transaction, so the reward is too.
            Minting one lot and minting the full 1% cost you the same fee and
            earn the same {commas(MINTS_PER_MINT)} MINTS — there is nothing to
            gain by splitting a mint into smaller pieces.
          </Faq>
          <Faq q="When do I get paid?">
            Rewards accrue as you mint and are sent out in batches. Nothing
            expires; the count above is what is left of the programme.
          </Faq>
          <Faq q="Doesn't minting cost me the XCP?">
            No — a mint escrows XCP against the launch. If it graduates you
            hold the tokens; if it refunds you get every satoshi back. The
            only thing a mint actually costs you is the Bitcoin fee — which is
            the part this programme covers.
          </Faq>
        </div>
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
function Podium({ graduated, winners }: { graduated: number; winners: string[] }) {
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
        const winner = winners[i];
        return (
          <div key={b.place} className="flex flex-col items-center">
            <div
              className={`mb-2 flex size-9 items-center justify-center rounded-full bg-white text-sm font-bold text-gray-700 ring-2 ${ring}`}
            >
              {i + 1}
            </div>
            <div className="whitespace-nowrap text-center text-lg font-bold tabular-nums text-gray-900 sm:text-xl">
              {commas(b.xcp)}{" "}
              <span className="text-sm font-medium text-gray-500">XCP</span>
            </div>
            {/* The step. Height encodes the prize; the label sits inside it. */}
            <div
              className={`mt-2 flex w-full ${height} items-start justify-center rounded-t-xl bg-gradient-to-b ${accent} pt-2`}
            >
              {claimed ? (
                winner ? (
                  <Link href={`/${winner}`} className="flex max-w-full items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-green-700">
                    <TokenImage asset={winner} className="size-4 rounded-full object-cover" />
                    <span className="truncate">{winner}</span>
                  </Link>
                ) : (
                  <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-green-700">claimed</span>
                )
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

function Faq({
  q,
  open = false,
  children,
}: {
  q: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="p-4" open={open}>
      <summary className="cursor-pointer text-sm font-medium text-gray-900">{q}</summary>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{children}</p>
    </details>
  );
}
