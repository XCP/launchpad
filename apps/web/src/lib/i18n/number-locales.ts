import { isLocale, type Locale } from "@/lib/i18n/locales";

/** Number conventions can be offered without adding an interface catalog. */
export const NUMBER_LOCALE_VARIANTS = [
  { locale: "de-DE", native: "Deutsch (Deutschland)" },
  { locale: "es-ES", native: "Español (España)" },
  { locale: "es-VE", native: "Español (Venezuela)" },
] as const;

export type NumberLocale = Locale | (typeof NUMBER_LOCALE_VARIANTS)[number]["locale"];
export function isNumberLocale(value: unknown): value is NumberLocale {
  return isLocale(value) || NUMBER_LOCALE_VARIANTS.some(entry => entry.locale === value);
}
