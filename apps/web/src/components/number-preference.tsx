"use client";

import { useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_INFO } from "@/lib/i18n/locales";
import { NUMBER_LOCALE_VARIANTS } from "@/lib/i18n/number-locales";
import { setNumberLocale, useNumberPreference, type NumberLocale } from "@/lib/number-preference";

export function NumberPreference() {
  const t = useT();
  const { locale, auto } = useNumberPreference();
  return <label className="flex flex-wrap items-center gap-2 text-xs">
    <span>{t("Number format")}</span>
    <select className="rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
      value={auto ? "auto" : locale} onChange={event => setNumberLocale(event.target.value as NumberLocale | "auto")}>
      <option value="auto">{t("Follow language")}</option>
      {LOCALES.map(value => <option value={value} key={value}>
        {LOCALE_INFO[value].native} · {new Intl.NumberFormat(LOCALE_INFO[value].intl).format(123456.78)}
      </option>)}
      {NUMBER_LOCALE_VARIANTS.map(entry => <option key={entry.locale} value={entry.locale} lang={entry.locale}>
        {entry.native} · {new Intl.NumberFormat(entry.locale).format(123456.78)}
      </option>)}
    </select>
  </label>;
}
