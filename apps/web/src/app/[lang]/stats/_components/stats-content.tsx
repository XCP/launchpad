"use client";

import { rich } from "@/lib/i18n/rich";
import { LazyLink } from "@/components/lazy-link";
import type { fetchCommunities, fetchLaunchStats } from "@/lib/api/launchpad-api";
import { CommunitiesSection } from "@/app/[lang]/stats/_components/communities";
import { EcosystemActivity } from "@/app/[lang]/stats/_components/ecosystem-activity";
import { Stat } from "@/app/[lang]/stats/_components/stat";
import type { fetchXcpUsd, fetchXcpUsdHistory } from "@/lib/api/price";
import { fromSats } from "@/lib/format";
import { Fiat } from "@/components/fiat";
import { historicalUsdAt } from "@/lib/market";
import { LABEL } from "@/components/ui/tokens";
import { useNumbers } from "@/lib/i18n/numbers";
import { useT } from "@/lib/i18n/client";

const WINDOW_DAYS = 28;

export function StatsContent({ height, stats, xcpUsd, xcpUsdHistory, communities }: {
  height: number;
  stats: Awaited<ReturnType<typeof fetchLaunchStats>>;
  xcpUsd: Awaited<ReturnType<typeof fetchXcpUsd>>;
  xcpUsdHistory: Awaited<ReturnType<typeof fetchXcpUsdHistory>>;
  communities: Awaited<ReturnType<typeof fetchCommunities>>;
}) {
  const num = useNumbers();
  const t = useT();
  if (!stats) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {t("Stats are unavailable right now.")}
      </p>
    );
  }

  const { counts, total, activity, blocks_per_bucket } = stats;
  const settled = counts.graduated + counts.refunded;
  const activeXcp = fromSats(activity.active_xcp);
  const poolXcp = fromSats(stats.markets?.pool_xcp ?? 0);
  const marketCapXcp = fromSats(stats.markets?.market_cap_xcp ?? 0);
  const tradeXcp = fromSats(stats.markets?.trade_xcp ?? 0);
  const historicalTradeUsd = (stats.markets?.trade_daily ?? []).reduce(
    (sum, day) => {
      const rate = historicalUsdAt(xcpUsdHistory, day.time);
      return rate === null ? sum : sum + fromSats(day.xcp) * rate;
    },
    0,
  );

  const newest = Math.floor((stats.ecosystem?.height ?? height) / blocks_per_bucket);
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

  // "about today" or "about 3d ago" — the bar tooltips' when-clause.
  const about = (daysAgo: number) =>
    daysAgo === 0 ? t("today") : t("{n}d ago", { n: daysAgo });

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("Stats")}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("Trading, burns and minting across XCP-69.")}
        </p>
      </div>

      <EcosystemActivity stats={stats} />

      <section>
        <h2 className={`mb-3 ${LABEL}`}>{t("Ecosystem overview")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            className="order-1 sm:order-none"
            label={t("Market cap")}
            value={`${num.fixed(marketCapXcp, 1)} XCP`}
            hint={
              xcpUsd
                ? rich(t, "≈ {amount} · graduated coins", { amount: <Fiat usd={marketCapXcp * xcpUsd} /> })
                : t("graduated coins")
            }
            mobileHint={
              xcpUsd
                ? rich(t, "≈ {amount} · graduated", { amount: <Fiat usd={marketCapXcp * xcpUsd} /> })
                : t("graduated")
            }
          />
          <Stat
            className="order-2 sm:order-none"
            label={t("XCP in pools")}
            // Not "locked pools": a graduated launch burns its LP, but the number
            // also carries pools whose liquidity is not locked, and calling all
            // of it locked promised something this figure cannot back.
            value={`${num.fixed(poolXcp, 1)} XCP`}
            hint={
              xcpUsd
                ? rich(t, "≈ {amount} in pools", { amount: <Fiat usd={poolXcp * xcpUsd} /> })
                : t("in pools")
            }
          />
          <Stat
            className="order-6 sm:order-none"
            label={t("Trade volume")}
            // Trades only, deliberately, and not added to mint escrow. The two
            // are not the same kind of number: escrowed XCP comes back on a
            // refunded launch, so it was committed rather than transacted.
            // This is XCP that actually changed hands, which is the harder
            // number to produce and the one worth showing on its own.
            value={`${num.fixed(tradeXcp, 1)} XCP`}
            hint={
              historicalTradeUsd > 0
                ? rich(t, "≈ {amount} traded, all time", { amount: <Fiat usd={historicalTradeUsd} /> })
                : t("traded, all time")
            }
          />
          <Stat
            className="order-3 sm:order-none"
            label={t("Mints")}
            value={num.commas(activity.mints)}
            hint={t("mint transactions")}
          />
          <Stat
            className="order-4 sm:order-none"
            label={t("Minters")}
            value={num.commas(activity.minters)}
            hint={t("distinct addresses")}
          />
          <Stat
            className="order-5 sm:order-none"
            label={t("Active escrow")}
            value={`${num.fixed(activeXcp, 1)} XCP`}
            hint={
              xcpUsd
                ? rich(t, "≈ {amount} committed to open mints", { amount: <Fiat usd={activeXcp * xcpUsd} /> })
                : t("committed to open mints")
            }
            mobileHint={
              xcpUsd
                ? rich(t, "≈ {amount} committed", { amount: <Fiat usd={activeXcp * xcpUsd} /> })
                : t("committed")
            }
          />
        </div>

      </section>

      <section>
        <h2 className={`mb-3 ${LABEL}`}>{t("Launches by phase")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("Scheduled")} value={num.commas(counts.scheduled)} hint={t("announced, not open")} />
          <Stat label={t("Minting")} value={num.commas(counts.minting)} hint={t("open right now")} />
          <Stat label={t("Graduated")} value={num.commas(counts.graduated)} hint={t("sold out, pool locked")} />
          <Stat label={t("Refunded")} value={num.commas(counts.refunded)} hint={t("missed the cap, paid back")} />
        </div>
      </section>


      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("Of the launches that finished")}</h2>
        {settled === 0 ? (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t("None have finished yet — nothing to score.")}</p>
        ) : (
          <>
            {/* Both shares of one bar: the bar is every SETTLED launch, so the
                widths compare against each other rather than against a total
                that includes launches still in flight. */}
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="bg-green-500" style={{ width: `${(counts.graduated / settled) * 100}%` }} />
              <div className="bg-gray-400 dark:bg-gray-500" style={{ width: `${(counts.refunded / settled) * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs tabular-nums">
              <span className="font-medium text-green-700 dark:text-green-400">
                {t("{n} graduated · {pct}%", {
                  n: counts.graduated,
                  pct: ((counts.graduated / settled) * 100).toFixed(0),
                })}
              </span>
              <span className="font-medium text-gray-500 dark:text-gray-400">
                {t("{n} refunded · {pct}%", {
                  n: counts.refunded,
                  pct: ((counts.refunded / settled) * 100).toFixed(0),
                })}
              </span>
            </div>
          </>
        )}
        <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {t(
            "A refunded launch is not money lost. XCP-69 is all-or-nothing: one that misses its soft cap returns every satoshi by consensus, with no decision by us and no way for anyone to keep it.",
          )}{" "}
          <LazyLink href="/faq" className="text-purple-600 dark:text-purple-400 hover:underline">
            {t("How that works")}
          </LazyLink>
        </p>

        <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("Refund activity")}</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {t("{n} in the last {days} days", { n: num.commas(refundTotal), days: WINDOW_DAYS })}
            </span>
          </div>
          {refundPeak === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t("No launches refunded in this window.")}</p>
          ) : (
            <>
              <div className="mt-4 flex h-20 items-end gap-[3px]">
                {refundSeries.map((d) => (
                  <div
                    key={d.bucket}
                    title={
                      d.n === 1
                        ? t("{n} refund · {xcp} XCP returned · about {when}", {
                            n: d.n,
                            xcp: num.fixed(d.xcp, 1),
                            when: about(d.daysAgo),
                          })
                        : t("{n} refunds · {xcp} XCP returned · about {when}", {
                            n: d.n,
                            xcp: num.fixed(d.xcp, 1),
                            when: about(d.daysAgo),
                          })
                    }
                    className="flex-1 rounded-t-sm bg-gray-300 dark:bg-gray-600 transition-colors hover:bg-gray-500"
                    style={{ height: `${Math.max(2, (d.n / refundPeak) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-gray-400 dark:text-gray-500">
                <span>{t("{n}d ago", { n: WINDOW_DAYS })}</span>
                <span>{t("now")}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {communities && <CommunitiesSection data={communities} />}

      <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
        {total === 1
          ? t("{n} conforming launch · chain tip {height}", { n: num.commas(total), height: num.commas(height) })
          : t("{n} conforming launches · chain tip {height}", { n: num.commas(total), height: num.commas(height) })}
      </p>
    </div>
  );
}
