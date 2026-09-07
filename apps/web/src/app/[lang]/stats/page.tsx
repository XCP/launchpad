import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages, getT } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import { rich } from "@/lib/i18n/rich";
import type { Metadata } from "next";
import { LazyLink } from "@/components/lazy-link";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchCommunities, fetchLaunchStats } from "@/lib/api/launchpad-api";
import { CommunitiesSection } from "@/app/[lang]/stats/_components/communities";
import { Stat } from "@/app/[lang]/stats/_components/stat";
import { fetchXcpUsd, fetchXcpUsdHistory } from "@/lib/api/price";
import { commas, fromSats } from "@/lib/format";
import { Fiat } from "@/components/fiat";
import { historicalUsdAt } from "@/lib/market";
import { LABEL } from "@/components/ui/tokens";

const PAGE_METADATA: Metadata = {
  title: msg("Stats — xcp.fun"),
  description: msg("XCP-69 launches by phase, and what has actually been minted."),
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
    alternates: localeAlternates(locale, "/stats"),
  };
}

export const revalidate = 60;

/** How many ~daily buckets the chart shows. Matches the window apps/api
 *  returns; anything longer stops being "lately". */
const WINDOW_DAYS = 28;

/** Stats are aggregate estimates, so one decimal keeps partial XCP visible
 * without implying transaction-level precision. Keep every XCP figure on
 * this page on the same visual scale. */
const formatXcp = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

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
  const t = await getT();
  const height = await fetchBlockHeight();
  const [stats, xcpUsd, xcpUsdHistory, communities] = await Promise.all([
    fetchLaunchStats(height),
    fetchXcpUsd(),
    fetchXcpUsdHistory(),
    fetchCommunities(),
  ]);

  if (!stats) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {t("Stats are unavailable right now.")}
      </p>
    );
  }

  const { counts, total, activity, daily, blocks_per_bucket } = stats;
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

  // "about today" or "about 3d ago" — the bar tooltips' when-clause.
  const about = (daysAgo: number) =>
    daysAgo === 0 ? t("today") : t("{n}d ago", { n: daysAgo });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("Stats")}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("Every launch that conforms to XCP-69, and what has actually been minted.")}
        </p>
      </div>

      {/* Two columns on a phone, three above it. The tiles are ordered for the
          phone with `order-*` and released back to source order at `sm`, where
          three-across already pairs them sensibly. On two columns the pairs
          are what matter: market cap beside the pools backing it, mints beside
          the minters who made them, and the two money-in-motion figures — XCP
          committed to open mints, XCP that has actually traded — side by side
          rather than split across the whole grid. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          className="order-1 sm:order-none"
          label={t("Market cap")}
          value={`${formatXcp(marketCapXcp)} XCP`}
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
          value={`${formatXcp(poolXcp)} XCP`}
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
          value={`${formatXcp(tradeXcp)} XCP`}
          hint={
            historicalTradeUsd > 0
              ? rich(t, "≈ {amount} traded, all time", { amount: <Fiat usd={historicalTradeUsd} /> })
              : t("traded, all time")
          }
        />
        <Stat
          className="order-3 sm:order-none"
          label={t("Mints")}
          value={commas(activity.mints)}
          hint={t("mint transactions")}
        />
        <Stat
          className="order-4 sm:order-none"
          label={t("Minters")}
          value={commas(activity.minters)}
          hint={t("distinct addresses")}
        />
        <Stat
          className="order-5 sm:order-none"
          label={t("Active escrow")}
          value={`${formatXcp(activeXcp)} XCP`}
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
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("Minting activity")}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {t("{n} in the last {days} days", { n: commas(windowTotal), days: WINDOW_DAYS })}
          </span>
        </div>

        {peak === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t("No mints in this window.")}</p>
        ) : (
          <>
            <div className="mt-4 flex h-24 items-end gap-[3px]">
              {series.map((d) => (
                <div
                  key={d.bucket}
                  title={
                    d.n === 1
                      ? t("{n} mint · about {when}", { n: d.n, when: about(d.daysAgo) })
                      : t("{n} mints · about {when}", { n: d.n, when: about(d.daysAgo) })
                  }
                  className="flex-1 rounded-t-sm bg-purple-200 dark:bg-purple-800/60 transition-colors hover:bg-purple-400"
                  // A zero day keeps a hairline so the axis stays readable as
                  // an axis rather than becoming a row of gaps.
                  style={{ height: `${Math.max(2, (d.n / peak) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-gray-400 dark:text-gray-500">
              <span>{t("{n}d ago", { n: WINDOW_DAYS })}</span>
              <span>{t("now")}</span>
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          {t(
            "Grouped by 144 blocks — a Bitcoin day. Exact against the chain, and approximate against a wall clock, which is the right way round for a chain this page is describing.",
          )}
        </p>
      </section>

      <section>
        <h2 className={`mb-3 ${LABEL}`}>{t("Launches by phase")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("Scheduled")} value={commas(counts.scheduled)} hint={t("announced, not open")} />
          <Stat label={t("Minting")} value={commas(counts.minting)} hint={t("open right now")} />
          <Stat label={t("Graduated")} value={commas(counts.graduated)} hint={t("sold out, pool locked")} />
          <Stat label={t("Refunded")} value={commas(counts.refunded)} hint={t("missed the cap, paid back")} />
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
              {t("{n} in the last {days} days", { n: commas(refundTotal), days: WINDOW_DAYS })}
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
                            xcp: formatXcp(d.xcp),
                            when: about(d.daysAgo),
                          })
                        : t("{n} refunds · {xcp} XCP returned · about {when}", {
                            n: d.n,
                            xcp: formatXcp(d.xcp),
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
          ? t("{n} conforming launch · chain tip {height}", { n: commas(total), height: commas(height) })
          : t("{n} conforming launches · chain tip {height}", { n: commas(total), height: commas(height) })}
      </p>
    </div>
  );
}
