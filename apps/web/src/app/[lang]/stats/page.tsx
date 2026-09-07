import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import type { Metadata } from "next";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchCommunities, fetchLaunchStats } from "@/lib/api/launchpad-api";
import { fetchXcpUsd, fetchXcpUsdHistory } from "@/lib/api/price";
import { StatsContent } from "@/app/[lang]/stats/_components/stats-content";

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

export default async function StatsPage() {
  const height = await fetchBlockHeight();
  const [stats, xcpUsd, xcpUsdHistory, communities] = await Promise.all([
    fetchLaunchStats(height),
    fetchXcpUsd(),
    fetchXcpUsdHistory(),
    fetchCommunities(),
  ]);

  return <StatsContent height={height} stats={stats} xcpUsd={xcpUsd} xcpUsdHistory={xcpUsdHistory} communities={communities} />;
}
