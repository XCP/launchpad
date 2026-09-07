import type { Metadata } from "next";
import { LOCALE_INFO, LOCALES, type Locale, localePath } from "@/lib/i18n/locales";

/**
 * The hreflang set for one page, from one list.
 *
 * Google ignores an hreflang set unless every version links to every other
 * AND to itself, so this is generated rather than written per page: the
 * page names its path once, and the set is whatever LOCALES says. Canonical
 * is the page's own locale URL, not the English one — pointing every
 * language at English is how a site ends up with only English indexed.
 * `x-default` is English, which is what an unmatched language gets.
 */
export function localeAlternates(locale: Locale, path: string): NonNullable<Metadata["alternates"]> {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[LOCALE_INFO[l].tag] = localePath(l, path);
  languages["x-default"] = localePath("en", path);
  return { canonical: localePath(locale, path), languages };
}
