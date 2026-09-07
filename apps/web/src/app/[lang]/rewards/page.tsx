import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import type { Numbers } from "@/lib/i18n/numbers";
import { getMessages, getNumbers, getT } from "@/lib/i18n/server";
import { makeT, msg, type T } from "@/lib/i18n/t";
import { rich } from "@/lib/i18n/rich";
import type { Metadata } from "next";
import { LazyLink } from "@/components/lazy-link";
import { fetchBlockHeight, fetchPool } from "@/lib/api/counterparty";
import {
  fetchLaunchPage,
  fetchLaunchStats,
  fetchMinterEarnings,
  fetchRewardBatches,
} from "@/lib/api/launchpad-api";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { shortAddress } from "@/lib/format";
import { ratio } from "@/lib/numeric";
import { LABEL } from "@/components/ui/tokens";
import { TokenImage } from "@/components/token-image";
import { XCP69_MIN_PARTICIPANTS, XCP69_RAISE_SATS } from "@/lib/xcp69";
import {
  BOUNTIES,
  FALLBACK_MINT_FEE_SATS,
  MINT_CAP,
  MINTS_PER_MINT,
  MINTS_PRICE_XCP,
  SATS_PER_XCP,
} from "@/lib/rewards";
import { EarnersTable } from "@/app/[lang]/rewards/_components/earners-table";

const PAGE_METADATA: Metadata = {
  title: msg("XCP Rewards — xcp.fun"),
  description:
    msg("An XCP bounty for the first three launches to graduate, and MINTS for every mint."),
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
    alternates: localeAlternates(locale, "/rewards"),
  };
}

export const revalidate = 60;

const raiseXcp = XCP69_RAISE_SATS / 1e8;

/**
 * Not in the nav — the header's green rewards chip is the one pointer to
 * this page, beside the mempool chip.
 */
export default async function RewardsPage() {
  const num = await getNumbers();
  const t = await getT();
  const height = await fetchBlockHeight().catch(() => 0);
  const [stats, earners, graduates, mintsPool, xcpUsd, btcUsd, rewardBatches] = await Promise.all([
    fetchLaunchStats(height).catch(() => null),
    fetchMinterEarnings(25).catch(() => []),
    fetchLaunchPage("graduated", "graduated", 3, 0).catch(() => null),
    // The MINTS/XCP pool is live on-chain; its reserve ratio IS the price.
    // The constant in lib/rewards is the seeded ratio, kept as the fallback
    // so an API hiccup never renders a reward worth zero.
    fetchPool("MINTS").catch(() => null),
    fetchXcpUsd().catch(() => null),
    fetchBtcUsd().catch(() => null),
    fetchRewardBatches().catch(() => []),
  ]);
  // The chain keeps minting after this programme ends; the progress meter is
  // programme progress, so it stops at its cap rather than saying 10,001 of
  // 10,000 later.
  const mintsSoFar = Math.min(MINT_CAP, stats?.activity.mints ?? 0);
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
  const feeSamples = stats?.activity.fee_samples ?? 0;
  const measuredFee = stats?.activity.median_fee_sats ?? 0;
  const typicalMintFeeSats = measuredFee > 0 ? measuredFee : FALLBACK_MINT_FEE_SATS;
  const feeXcp = typicalMintFeeSats / satsPerXcp;
  // Both are small XCP figures quoted to the cent; two decimals always, so
  // they line up with each other and with the pool price beside them.
  const twoDp = (value: number) =>
    value.toLocaleString(num.intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* No page title — the chip that brought you here already said XCP
          Rewards, and the bounty section opens the page. */}
      {/* ---------------- the bounty ---------------- */}
      <section>
        <h2 className="text-lg font-bold">{t("The graduation bounty")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {graduated === 0
            ? t("No XCP-69 launch has graduated yet. The first three to do it earn a bounty.")
            : graduated === 1
              ? t("One bounty is claimed — two are still open for the next launches to graduate.")
              : graduated === 2
                ? t("Two bounties are claimed — one is still open for the next launch to graduate.")
                : t("All three bounties have been claimed.")}
        </p>

        <Podium t={t} num={num} graduated={graduated} winners={graduates?.rows.map((r) => r.fm.asset) ?? []} />

        <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {rich(
            t,
            "Graduating means selling out: {xcp} XCP raised from at least {n} different addresses, at which point the pool is created and its liquidity is burned. A launch that misses its target refunds every satoshi by consensus and does not count. {link}",
            {
              xcp: num.commas(raiseXcp),
              n: XCP69_MIN_PARTICIPANTS,
              link: (
                <LazyLink href="/faq" className="text-purple-600 dark:text-purple-400 hover:underline">
                  {t("How that works")}
                </LazyLink>
              ),
            },
          )}
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
            {t("{n} MINTS for every mint", { n: num.commas(MINTS_PER_MINT) })}
          </h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {t(
            "Mint any XCP-69 launch and earn {n} MINTS. It doesn't matter which launch, and it doesn't matter how much you mint — one transaction, one reward (valid for the first {cap} mint transactions).",
            { n: num.commas(MINTS_PER_MINT), cap: num.commas(MINT_CAP) },
          )}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("Per mint")} value={`${num.commas(MINTS_PER_MINT)} MINTS`} hint={t("one transaction")} />
          <Stat
            label={t("Worth")}
            value={`${twoDp(rewardXcp)} XCP`}
            hint={t("at the live pool price")}
          />
          <Stat
            label={t("Your fee")}
            value={`~${num.commas(typicalMintFeeSats)} sats`}
            hint={
              measuredFee > 0
                ? t("~{xcp} XCP · {n}-mint median", { xcp: twoDp(feeXcp), n: num.commas(feeSamples) })
                : t("~{xcp} XCP · estimate", { xcp: twoDp(feeXcp) })
            }
          />
          <Stat
            label={t("Covered")}
            value={num.percent(rewardXcp / feeXcp, { digits: 0 })}
            hint={t("of the typical mint fee")}
          />
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>{t("Mints so far")}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {t("{n} of {cap}", { n: num.commas(mintsSoFar), cap: num.commas(MINT_CAP) })}
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: `${Math.min(100, (mintsSoFar / MINT_CAP) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {t("{n} still to claim", { n: num.commas(remaining) })}
          </p>
        </div>
      </section>

      {rewardBatches.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">{t("Distributions")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {t("Completed and confirming reward batches, linked to the transactions that sent them.")}
          </p>
          <div className="mt-4 space-y-3">
            {rewardBatches.map((batch) => {
              const fullyLinked = batch.sentRecipientCount === batch.recipientCount;
              const confirmed =
                fullyLinked && batch.transactions.every((tx) => tx.status === "confirmed");
              const state = confirmed ? t("Confirmed") : fullyLinked ? t("Confirming") : t("Partially sent");
              return (
                <div key={batch.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {t("Mints {from}–{to}", {
                          from: num.commas(batch.firstMintNumber),
                          to: num.commas(batch.cutoffMintNumber),
                        })}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                        {t("{recipients} recipients · {mints} mint transactions", {
                          recipients: num.commas(batch.recipientCount),
                          mints: num.commas(batch.eligibleMints),
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                        {num.commasRaw(batch.sentQuantity)} {batch.asset}
                      </p>
                      {!fullyLinked && (
                        <p className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                          {t("of {n} in the batch", { n: num.commasRaw(batch.totalQuantity) })}
                        </p>
                      )}
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        confirmed ? "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400" : "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400"
                      }`}>
                        {state}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {batch.transactions.map((tx) => (
                      <a
                        key={tx.txHash}
                        href={`https://xcp.io/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-purple-600 dark:text-purple-400 hover:underline"
                        title={tx.txHash}
                      >
                        {tx.method === "mpma" ? "MPMA" : t("Send")} {shortAddress(tx.txHash)} ↗
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------- who has earned what ---------------- */}
      <section>
        <h2 className="text-lg font-bold">{t("Earned so far")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {t("Every mint on a conforming launch, counted. Ranked by mints, because that is the unit the reward is paid in.")}
        </p>

        <EarnersTable initial={earners} />
      </section>

      {/* ---------------- the small print, in the site's FAQ grammar ---------------- */}
      <section>
        <h2 className="text-lg font-bold">{t("FAQ")}</h2>
        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <Faq q={t("What is MINTS?")} open>
            {t(
              "The first fairminter ever created on Counterparty — block 866,297, before any other, and it minted out free to 1,376 addresses. The supply is 100,000,000, locked forever; no more can ever be issued. The live MINTS/XCP pool prices the reward: right now 1 MINTS trades at {price} XCP, so {n} MINTS is {worth} XCP.",
              { price: num.price(mintsPriceXcp), n: num.commas(MINTS_PER_MINT), worth: twoDp(rewardXcp) },
            )}
          </Faq>
          <Faq q={t("Why per transaction, not per token?")}>
            {t(
              "The Bitcoin fee you pay is per transaction, so the reward is too. Minting one lot and minting the full 1% cost you the same fee and earn the same {n} MINTS — there is nothing to gain by splitting a mint into smaller pieces.",
              { n: num.commas(MINTS_PER_MINT) },
            )}
          </Faq>
          <Faq q={t("When do I get paid?")}>
            {t(
              "Rewards accrue as you mint and are sent in batches. Once yours is sent, its transaction appears on your profile. Lifetime earned is an all-time total, not your wallet balance.",
            )}
          </Faq>
          <Faq q={t("Doesn't minting cost me the XCP?")}>
            {t(
              "No — a mint escrows XCP against the launch. If it graduates you hold the tokens; if it refunds you get every satoshi back. The only thing a mint actually costs you is the Bitcoin fee — which is the part this programme covers.",
            )}
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
function Podium({ t, num, graduated, winners }: { t: T; num: Numbers; graduated: number; winners: string[] }) {
  // Visual order, not rank order.
  const layout = [
    { i: 1, height: "h-20", accent: "from-gray-300 dark:from-gray-700 to-gray-200 dark:to-gray-800", ring: "ring-gray-300 dark:ring-gray-700" },
    { i: 0, height: "h-28", accent: "from-amber-300 dark:from-amber-700 to-amber-200 dark:to-amber-800", ring: "ring-amber-400" },
    { i: 2, height: "h-14", accent: "from-orange-300/70 dark:from-orange-700/70 to-orange-200/70 dark:to-orange-800/70", ring: "ring-orange-300" },
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
              className={`mb-2 flex size-9 items-center justify-center rounded-full bg-white dark:bg-gray-900 text-sm font-bold text-gray-700 dark:text-gray-300 ring-2 ${ring}`}
            >
              {i + 1}
            </div>
            <div className="whitespace-nowrap text-center text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100 sm:text-xl">
              {num.commas(b.xcp)}{" "}
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">XCP</span>
            </div>
            {/* The step. Height encodes the prize; the label sits inside it. */}
            <div
              className={`mt-2 flex w-full ${height} items-start justify-center rounded-t-xl bg-gradient-to-b ${accent} pt-2`}
            >
              {claimed ? (
                winner ? (
                  <LazyLink href={`/${winner}`} className="flex max-w-full items-center gap-1 rounded-full bg-white/90 dark:bg-gray-900/90 px-2 py-1 text-[10px] font-semibold text-green-700 dark:text-green-400">
                    <TokenImage asset={winner} className="size-4 rounded-full object-cover" />
                    <span className="truncate">{winner}</span>
                  </LazyLink>
                ) : (
                  <span className="rounded-full bg-white/90 dark:bg-gray-900/90 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">{t("claimed")}</span>
                )
              ) : (
                <span className="rounded-full bg-white/70 dark:bg-gray-900/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">
                  {t("open", undefined, "bounty")}
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
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 truncate text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-gray-400 dark:text-gray-500">{hint}</div>
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
      <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">{q}</summary>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{children}</p>
    </details>
  );
}
