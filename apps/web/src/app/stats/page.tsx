import type { Metadata } from "next";
import Link from "next/link";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchLaunchStats } from "@/lib/api/launchpad-api";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { commas, fromSats, usd } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";

export const metadata: Metadata = {
  title: "Stats — xcp.fun",
  description: "XCP-69 launches by phase, and what has actually been minted.",
};

export const revalidate = 60;

/** How many ~daily buckets the chart shows. Matches the window apps/api
 *  returns; anything longer stops being "lately". */
const WINDOW_DAYS = 28;

/**
 * The scoreboard, and the one place refunded launches are counted.
 *
 * They were a "Graveyard" section on the front page, which gave failures the
 * same weight as live launches — a front page should show what's happening.
 * The number still matters, and arguably matters more here: all-or-nothing
 * only means something if the refunds are visible somewhere, and hiding them
 * entirely would be the dishonest way to remove that section.
 */
export default async function StatsPage() {
  const height = await fetchBlockHeight();
  const [stats, xcpUsd, btcUsd] = await Promise.all([
    fetchLaunchStats(height),
    fetchXcpUsd(),
    fetchBtcUsd(),
  ]);

  if (!stats) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        Stats are unavailable right now.
      </p>
    );
  }

  const { counts, total, activity, daily, blocks_per_bucket } = stats;
  const settled = counts.graduated + counts.refunded;
  const committedXcp = fromSats(activity.paid_xcp);
  const activeXcp = fromSats(activity.active_xcp);
  const feeBtc = fromSats(activity.fee_sats);

  // Fill the window so quiet days read as quiet rather than as missing. The
  // bucket is `block / 144`, so the newest bucket is the one the tip is in.
  const newest = Math.floor(height / blocks_per_bucket);
  const byBucket = new Map(daily.map((d) => [d.bucket, d]));
  const series = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const bucket = newest - (WINDOW_DAYS - 1 - i);
    return { bucket, daysAgo: newest - bucket, n: byBucket.get(bucket)?.n ?? 0 };
  });
  const peak = series.reduce((m, d) => Math.max(m, d.n), 0);
  const windowTotal = series.reduce((sum, d) => sum + d.n, 0);
  const refundsByBucket = new Map((stats.refunds_daily ?? []).map((d) => [d.bucket, d]));
  const refundSeries = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const bucket = newest - (WINDOW_DAYS - 1 - i);
    const refund = refundsByBucket.get(bucket);
    return {
      bucket,
      daysAgo: newest - bucket,
      n: refund?.n ?? 0,
      xcp: fromSats(refund?.xcp ?? 0),
    };
  });
  const refundPeak = refundSeries.reduce((m, d) => Math.max(m, d.n), 0);
  const refundTotal = refundSeries.reduce((sum, d) => sum + d.n, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Stats</h1>
        <p className="mt-1 text-sm text-gray-600">
          Every launch that conforms to XCP-69, and what has actually been minted.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Minted" value={commas(activity.mints)} hint="mint transactions" />
        <Stat label="Minters" value={commas(activity.minters)} hint="distinct addresses" />
        <Stat
          label="Active escrow"
          value={`${commas(activeXcp)} XCP`}
          hint={
            xcpUsd
              ? `≈ ${usd(activeXcp * xcpUsd)} baking in open mints`
              : "baking in open mints"
          }
        />
        <Stat
          label="Ever committed"
          value={`${commas(committedXcp)} XCP`}
          hint={xcpUsd ? `≈ ${usd(committedXcp * xcpUsd)}` : "across all mint history"}
        />
        <Stat
          label="Bitcoin fees"
          value={`${commas(activity.fee_sats)} sats`}
          hint={btcUsd ? `≈ ${usd(feeBtc * btcUsd)} paid to miners` : "paid to miners"}
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Minting activity</h2>
          <span className="text-xs text-gray-400 tabular-nums">
            {commas(windowTotal)} in the last {WINDOW_DAYS} days
          </span>
        </div>

        {peak === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No mints in this window.</p>
        ) : (
          <>
            <div className="mt-4 flex h-24 items-end gap-[3px]">
              {series.map((d) => (
                <div
                  key={d.bucket}
                  title={`${d.n} mint${d.n === 1 ? "" : "s"} · about ${
                    d.daysAgo === 0 ? "today" : `${d.daysAgo}d ago`
                  }`}
                  className="flex-1 rounded-t-sm bg-purple-200 transition-colors hover:bg-purple-400"
                  // A zero day keeps a hairline so the axis stays readable as
                  // an axis rather than becoming a row of gaps.
                  style={{ height: `${Math.max(2, (d.n / peak) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-gray-400">
              <span>{WINDOW_DAYS}d ago</span>
              <span>now</span>
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
          Grouped by 144 blocks — a Bitcoin day. Exact against the chain, and
          approximate against a wall clock, which is the right way round for a
          chain this page is describing.
        </p>
      </section>

      <section>
        <h2 className={`mb-3 ${LABEL}`}>Launches by phase</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Scheduled" value={commas(counts.scheduled)} hint="announced, not open" />
          <Stat label="Minting" value={commas(counts.minting)} hint="open right now" />
          <Stat label="Graduated" value={commas(counts.graduated)} hint="sold out, pool locked" />
          <Stat label="Refunded" value={commas(counts.refunded)} hint="missed the cap, paid back" />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Of the launches that finished</h2>
        {settled === 0 ? (
          <p className="mt-2 text-sm text-gray-500">None have finished yet — nothing to score.</p>
        ) : (
          <>
            {/* Both shares of one bar: the bar is every SETTLED launch, so the
                widths compare against each other rather than against a total
                that includes launches still in flight. */}
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-gray-100">
              <div className="bg-green-500" style={{ width: `${(counts.graduated / settled) * 100}%` }} />
              <div className="bg-gray-400" style={{ width: `${(counts.refunded / settled) * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs tabular-nums">
              <span className="font-medium text-green-700">
                {counts.graduated} graduated · {((counts.graduated / settled) * 100).toFixed(0)}%
              </span>
              <span className="font-medium text-gray-500">
                {counts.refunded} refunded · {((counts.refunded / settled) * 100).toFixed(0)}%
              </span>
            </div>
          </>
        )}
        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          A refunded launch is not money lost. XCP-69 is all-or-nothing: one
          that misses its soft cap returns every satoshi by consensus, with no
          decision by us and no way for anyone to keep it.{" "}
          <Link href="/faq" className="text-purple-600 hover:underline">
            How that works
          </Link>
        </p>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Refund activity</h3>
            <span className="text-xs text-gray-400 tabular-nums">
              {commas(refundTotal)} in the last {WINDOW_DAYS} days
            </span>
          </div>
          {refundPeak === 0 ? (
            <p className="mt-3 text-sm text-gray-500">No launches refunded in this window.</p>
          ) : (
            <>
              <div className="mt-4 flex h-20 items-end gap-[3px]">
                {refundSeries.map((d) => (
                  <div
                    key={d.bucket}
                    title={`${d.n} refund${d.n === 1 ? "" : "s"} · ${commas(d.xcp)} XCP returned · about ${d.daysAgo === 0 ? "today" : `${d.daysAgo}d ago`}`}
                    className="flex-1 rounded-t-sm bg-gray-300 transition-colors hover:bg-gray-500"
                    style={{ height: `${Math.max(2, (d.n / refundPeak) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-gray-400">
                <span>{WINDOW_DAYS}d ago</span>
                <span>now</span>
              </div>
            </>
          )}
        </div>
      </section>

      <p className="text-xs text-gray-400 tabular-nums">
        {commas(total)} conforming {total === 1 ? "launch" : "launches"} · chain tip{" "}
        {commas(height)}
      </p>
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
