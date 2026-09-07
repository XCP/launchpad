import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import type { Metadata } from "next";
import { fetchBlockHeight, fetchPool } from "@/lib/api/counterparty";
import {
  fetchLaunchPage,
  fetchLaunchStats,
  fetchMinterEarnings,
  fetchRewardBatches,
} from "@/lib/api/launchpad-api";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { RewardsContent } from "@/app/[lang]/rewards/_components/rewards-content";

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

export default async function RewardsPage() {
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

  return <RewardsContent stats={stats} earners={earners} graduates={graduates} mintsPool={mintsPool} xcpUsd={xcpUsd} btcUsd={btcUsd} rewardBatches={rewardBatches} />;
}
