import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import type { Metadata } from "next";
import { ActivityView } from "@/app/[lang]/activity/_components/activity-view";

const PAGE_METADATA: Metadata = {
  title: "Activity — xcp.fun",
  description:
    "Every XCP-69 mint, trade, burn, resting order and launch, newest first.",
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return { ...PAGE_METADATA, alternates: localeAlternates(isLocale(lang) ? lang : "en", "/activity") };
}

/* No revalidate directive, for the same reason /mempool has none: nothing on
 * this page is rendered from feed data. ActivityView is a client component
 * that polls for everything and this file fetches nothing, so a dynamic
 * directive would buy a server render per visitor of a shell that is identical
 * every time — precisely the cost that matters when a launch brings a surge of
 * them. The shell prerenders and caches; the client's poll is what makes the
 * page live, and that is untouched. */

/**
 * What landed.
 *
 * /mempool is the same page one confirmation earlier: it answers "has someone
 * already sent the transaction I am about to send". This one answers the
 * question the site could otherwise only answer one launch at a time — what is
 * actually happening here, across everything, right now. Four tapes over one
 * chronology, so the whole market fits in one scroll instead of in fifty open
 * tabs.
 */
export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <ActivityView />
    </div>
  );
}
