"use client";

import { DropdownMenu as DM } from "radix-ui";
import { usePathname } from "next/navigation";
import { LazyLink } from "@/components/lazy-link";
import { trackEvent } from "@/lib/analytics";
import { CURRENCIES, setCurrency, useCurrency } from "@/lib/currency";
import { useLocale, useT } from "@/lib/i18n/client";
import { LOCALE_INFO, LOCALES, type Locale, splitLocale } from "@/lib/i18n/locales";

export const LOCALE_PREF_KEY = "xcpfun:locale:v1";

/** Remembered so a return visit to the front door can go straight to the
 *  language chosen last time — see LocaleSuggest. */
export function rememberLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_PREF_KEY, locale);
  } catch {
    // Private mode: the URL still carries the choice for this visit.
  }
  // Every way of choosing a language ends here, so this is the one place
  // the choice is counted: which languages people actually switch to.
  trackEvent(`language chosen: ${locale}`);
}

export const MENU_ITEM =
  "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-800 data-[highlighted]:text-gray-900 dark:data-[highlighted]:text-gray-100 data-[state=open]:bg-gray-100 dark:data-[state=open]:bg-gray-800";

/**
 * The language menu: a globe and the current language's own name, with the
 * currency beneath it.
 *
 * A visitor who cannot read the page has to find this without reading, and
 * the globe is the one control every web user recognises regardless of
 * language. Each language is written in its own name, never as a flag —
 * flags are countries, and Chinese alone spans three. Choosing navigates to
 * the same path under the other prefix, so nothing about the page is lost.
 *
 * Currency rides along because the two are one decision to most people:
 * the language you read in sets the currency you see, unless you say
 * otherwise (see lib/currency). It is a submenu rather than a second list
 * so thirty currencies never swallow two languages.
 */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const pathname = usePathname();
  const { path } = splitLocale(pathname ?? "/");

  return (
    <DM.Root>
      <DM.Trigger
        aria-label={t("Language")}
        className={`flex items-center gap-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 ${
          compact ? "size-9 justify-center" : "h-9 px-3"
        }`}
      >
        <Globe />
        {!compact && <span>{LOCALE_INFO[locale].native}</span>}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={8}
          className="modal-pop z-50 w-52 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <LanguageItems path={path} />
          <DM.Separator className="my-1.5 h-px bg-gray-100 dark:bg-gray-800" />
          <CurrencySubmenu />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** One row per language, each in its own name, the current one ticked.
 *  Shared with the phone menu, which lists them inline. */
export function LanguageItems({ path }: { path: string }) {
  const locale = useLocale();
  return (
    <>
      {LOCALES.map((l) => (
        <DM.Item key={l} asChild>
          <LazyLink
            href={path}
            locale={l}
            lang={LOCALE_INFO[l].tag}
            hrefLang={LOCALE_INFO[l].tag}
            aria-current={l === locale ? "true" : undefined}
            onClick={() => rememberLocale(l)}
            className={`${MENU_ITEM} ${l === locale ? "text-gray-900 dark:text-gray-100" : ""}`}
          >
            {LOCALE_INFO[l].native}
            {l === locale && <Tick />}
          </LazyLink>
        </DM.Item>
      ))}
    </>
  );
}

/**
 * The currency, as a submenu: "Currency · JPY ▸" opens the full list with
 * Auto at the top. Auto shows what it currently resolves to, so a visitor
 * can see why the numbers are in yen before deciding whether to change it.
 */
export function CurrencySubmenu() {
  const t = useT();
  const { code, auto, detected } = useCurrency();
  const item = `${MENU_ITEM} text-xs`;
  return (
    <DM.Sub>
      <DM.SubTrigger className={MENU_ITEM}>
        <span>
          {t("Currency")}
          <span className="ms-2 text-gray-400 dark:text-gray-500">{code}</span>
        </span>
        <span aria-hidden className="text-gray-400">
          ›
        </span>
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent
          sideOffset={6}
          alignOffset={-6}
          className="modal-pop z-50 max-h-80 w-44 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <DM.Item className={item} onSelect={() => setCurrency("auto")}>
            {t("Auto ({code})", { code: detected })}
            {auto && <Tick />}
          </DM.Item>
          <DM.Separator className="my-1.5 h-px bg-gray-100 dark:bg-gray-800" />
          {CURRENCIES.map((c) => (
            <DM.Item key={c} className={item} onSelect={() => setCurrency(c)}>
              {c}
              {!auto && c === code && <Tick />}
            </DM.Item>
          ))}
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

function Tick() {
  return (
    <span aria-hidden className="text-gray-400">
      ✓
    </span>
  );
}

/** A globe, drawn rather than shipped as an icon dependency. */
export function Globe() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c2.2 2 2.2 11 0 13M8 1.5c-2.2 2-2.2 11 0 13" />
    </svg>
  );
}
