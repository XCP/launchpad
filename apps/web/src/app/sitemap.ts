import type { MetadataRoute } from "next";
import { fetchSearchIndex } from "@/lib/api/launchpad-api";
import { LOCALE_INFO, LOCALES, localePath } from "@/lib/i18n/locales";
import { METADATA_ORIGIN } from "@/lib/metadata";

/**
 * Every page in every language, each entry carrying the same hreflang set
 * the page itself emits, so a crawler that reads only the sitemap still
 * learns that `/faq` and `/ja/faq` are one page in two languages.
 *
 * Lives at the app root, outside the locale segment: there is one sitemap
 * for the site, and its own URL is never localized (the proxy skips paths
 * with an extension for exactly this reason).
 */
export const revalidate = 3600;

const STATIC_PATHS = ["/", "/graduated", "/minting", "/scheduled", "/faq", "/docs", "/stats", "/activity", "/swap", "/limit", "/dispense", "/rewards", "/mempool", "/graveyard", "/research", "/create"];

/** The homepage is `https://xcp.fun`, no trailing slash — exactly as the
 *  page's own canonical writes it. A sitemap that says `/` while the page
 *  says otherwise is the inconsistency crawlers punish. */
const absolute = (locale: Parameters<typeof localePath>[0], path: string) => {
  const p = localePath(locale, path);
  return `${METADATA_ORIGIN}${p === "/" ? "" : p}`;
};

function entries(path: string, priority: number): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[LOCALE_INFO[l].tag] = absolute(l, path);
  languages["x-default"] = absolute("en", path);
  return LOCALES.map((locale) => ({
    url: absolute(locale, path),
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const urls = STATIC_PATHS.flatMap((p) => entries(p, p === "/" ? 1 : 0.6));
  // Every conforming launch, whatever its phase: a refunded launch's page is
  // still its record. The index is the site's own, so an outage here means a
  // shorter sitemap rather than a failed one.
  try {
    const index = await fetchSearchIndex();
    for (const row of index ?? []) urls.push(...entries(`/${row.asset}`, 0.8));
  } catch {
    // Static pages only, this time.
  }
  return urls;
}
