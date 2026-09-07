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
 *
 * Chinese is three locales, not one. Simplified (`zh`) is what the mainland
 * and the Singapore and Malaysia diaspora read; Traditional differs by
 * region in vocabulary, not only in characters — Taiwan writes 軟體 and 網路
 * where Hong Kong writes 軟件 and 網絡 — so `zh-tw` and `zh-hk` are separate
 * files, derived from the Simplified draft with OpenCC's regional phrase
 * tables and then checked by hand.
 *
 * Spanish is one locale for the whole language. The site's Spanish readers
 * are in the Americas — Mexico, Venezuela, Argentina — so the draft is
 * Latin American in vocabulary (billetera, not cartera) and neutral enough
 * that Spain reads it without noticing. Korean is one locale and one
 * currency, and counts in 만/억 like Japanese and Chinese.
 *
 * Portuguese is Brazilian (`pt`, tagged pt-BR): Brazil is where the site's
 * Portuguese readers are, and Portugal reads Brazilian fine. French is one
 * locale for France, Belgium, Switzerland, Québec and the Maghreb, in the
 * neutral register French crypto interfaces use (vous, portefeuille).
 */
export const LOCALES = ["en", "ja", "zh", "zh-tw", "zh-hk", "es", "ko", "pt", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleInfo {
  /** The language's own name for itself, which is how a language menu is
   *  written: a reader who cannot read the page can still find their own. */
  native: string;
  /** BCP 47 tag for `<html lang>` and hreflang. Script and region are spelled
   *  out where they disambiguate: `zh-Hant-TW`, not `zh-TW`, so a crawler
   *  never has to guess the script. */
  tag: string;
  /** The Intl locale numbers and money are written in on this locale's
   *  pages. Distinct from `tag` because Intl wants a region to pick the
   *  currency symbol (US$ vs HK$) and the digit grouping. */
  intl: string;
  /** Open Graph's own locale form, language_TERRITORY. */
  og: string;
  dir: "ltr" | "rtl";
  /** Whether readers count in 万/億 rather than K/M/B. Japanese and every
   *  Chinese variant do; a reader who thinks in 万 has to convert K/M in
   *  their head, so money compacts the local way on these pages. */
  myriads: boolean;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { native: "English", tag: "en", intl: "en-US", og: "en_US", dir: "ltr", myriads: false },
  ja: { native: "日本語", tag: "ja", intl: "ja-JP", og: "ja_JP", dir: "ltr", myriads: true },
  zh: { native: "简体中文", tag: "zh-Hans", intl: "zh-CN", og: "zh_CN", dir: "ltr", myriads: true },
  "zh-tw": { native: "繁體中文（台灣）", tag: "zh-Hant-TW", intl: "zh-TW", og: "zh_TW", dir: "ltr", myriads: true },
  "zh-hk": { native: "繁體中文（香港）", tag: "zh-Hant-HK", intl: "zh-HK", og: "zh_HK", dir: "ltr", myriads: true },
  es: { native: "Español", tag: "es", intl: "es-MX", og: "es_LA", dir: "ltr", myriads: false },
  ko: { native: "한국어", tag: "ko", intl: "ko-KR", og: "ko_KR", dir: "ltr", myriads: true },
  pt: { native: "Português", tag: "pt-BR", intl: "pt-BR", og: "pt_BR", dir: "ltr", myriads: false },
  fr: { native: "Français", tag: "fr", intl: "fr-FR", og: "fr_FR", dir: "ltr", myriads: false },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The site locale a browser language tag maps to, or null when the site
 * has nothing for it. `ja-JP` is Japanese; Chinese is decided by script
 * first and region second, because a tag can carry either: `zh-Hant` and
 * `zh-TW` both mean Taiwan-style Traditional, `zh-HK` and `zh-MO` mean Hong
 * Kong-style, and a bare `zh`, `zh-CN`, `zh-SG` or `zh-Hans` means
 * Simplified. Cantonese (`yue`) reads Hong Kong Traditional. English maps to
 * the default so a caller can tell "prefers English" from "no opinion".
 */
export function matchLocale(tag: string): Locale | null {
  const [language = "", ...rest] = tag.toLowerCase().split("-");
  const parts = new Set(rest);
  if (language === "en") return "en";
  if (language === "ja") return "ja";
  if (language === "es") return "es";
  if (language === "ko") return "ko";
  if (language === "pt") return "pt";
  if (language === "fr") return "fr";
  if (language === "yue") return "zh-hk";
  if (language === "zh") {
    if (parts.has("hk") || parts.has("mo")) return "zh-hk";
    if (parts.has("hant") || parts.has("tw")) return "zh-tw";
    return "zh";
  }
  return null;
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
