import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import type { Metadata } from "next";
import { GraveyardList } from "@/app/[lang]/graveyard/_components/graveyard-list";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchLaunchPage } from "@/lib/api/launchpad-api";
import { type LaunchPage, PER_PAGE, toSectionRow } from "@/lib/launch-row";

const PAGE_METADATA: Metadata = {
  title: msg("Graveyard — xcp.fun"),
  description: msg("XCP-69 launches that closed below their soft cap and refunded participants."),
  // The route is intentionally available only to someone who knows it. It is
  // not linked from the site, and crawlers should not turn it into navigation.
  robots: { index: false, follow: false },
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
    alternates: localeAlternates(locale, "/graveyard"),
  };
}

export const revalidate = 60;

export default async function GraveyardPage() {
  const [height, indexed] = await Promise.all([
    fetchBlockHeight(),
    fetchLaunchPage("refunded", "failed", PER_PAGE.refunded, 0),
  ]);

  const initial: LaunchPage = indexed
    ? {
        rows: indexed.rows.map(toSectionRow),
        total: indexed.total,
        king: null,
      }
    : { rows: [], total: 0, king: null };

  return (
    <GraveyardList
      initial={initial}
      initialAvailable={indexed !== null}
      height={height}
    />
  );
}
