/**
 * The site's languages, and nothing about how any of them is rendered.
 *
 * This file is the one place the list lives: the locale segment validates
 * against it, the proxy prefixes with it, the switcher lists it, hreflang
 * enumerates it, and the sitemap multiplies by it. Adding a language is one
 * entry here plus one message file; nothing else learns about it.
 *
 * English has no prefix. Every other locale is a path prefix, and the URL is
 * the only thing that ever decides which language renders — never a header,
 * cookie or location, which is what keeps every page cacheable per URL and
 * every shared link showing the same thing to everyone who opens it. The
 * browser's language only ever produces a suggestion (see locale-suggest).
 */
export const LOCALES = ["en", "ja"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleInfo {
  /** The language's own name for itself, which is how a language menu is
   *  written: a reader who cannot read the page can still find their own. */
  native: string;
  /** BCP 47 tag for `<html lang>` and hreflang. */
  tag: string;
  /** Open Graph's own locale form, language_TERRITORY. */
  og: string;
  dir: "ltr" | "rtl";
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { native: "English", tag: "en", og: "en_US", dir: "ltr" },
  ja: { native: "日本語", tag: "ja", og: "ja_JP", dir: "ltr" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The locale a path is under, and the path without it. `/ja/faq` is
 * Japanese `/faq`; `/faq` is English `/faq`; `/ja` alone is the Japanese
 * homepage. Only exact lowercase codes count: an asset called `/JA` is an
 * asset, not a language, and asset names are uppercase by rule.
 */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const [, first = "", ...rest] = pathname.split("/");
  if (first !== DEFAULT_LOCALE && isLocale(first)) {
    const path = `/${rest.join("/")}`;
    return { locale: first, path: path === "/" ? "/" : path.replace(/\/$/, "") };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || "/" };
}

/** The same path under another locale: `/faq` in Japanese is `/ja/faq`,
 *  and the Japanese homepage is `/ja`, not `/ja/`. */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/**
 * Paths the locale prefix never applies to: route handlers, generated
 * images and files, and anything with an extension. The proxy leaves these
 * alone and the link component never prefixes them.
 */
export function isUnlocalizedPath(pathname: string): boolean {
  return (
    /^\/(api|i|j|art|icon|image-source|full|_next)(\/|$)/.test(pathname) ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}
