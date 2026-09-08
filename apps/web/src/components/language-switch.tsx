"use client";

import { DropdownMenu as DM } from "radix-ui";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LazyLink } from "@/components/lazy-link";
import { phaseForPath } from "@/lib/launch-directory";
import { trackEvent } from "@/lib/analytics";
import { CURRENCIES, currencyForLocale, setCurrency, useCurrency } from "@/lib/currency";
import { useLocale, useT } from "@/lib/i18n/client";
import { LOCALE_INFO, LOCALES, type Locale, splitLocale } from "@/lib/i18n/locales";

export const LOCALE_PREF_KEY = "xcpfun:locale:v1";

/** A deliberate language choice also selects its suggested currency.
 * Remember it for return visits, which must preserve any later currency
 * override rather than replay this action — see LocaleSuggest. */
export function rememberLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_PREF_KEY, locale);
  } catch {
    // Private mode: the URL still carries the choice for this visit.
  }
  setCurrency(currencyForLocale(locale));
  // Every way of choosing a language ends here, so this is the one place
  // the choice is counted: which languages people actually switch to.
  trackEvent(`language chosen: ${locale}`);
}

export const MENU_ITEM =
  "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-800 data-[highlighted]:text-gray-900 dark:data-[highlighted]:text-gray-100 data-[state=open]:bg-gray-100 dark:data-[state=open]:bg-gray-800";

/**
 * The language menu: a globe and the current language's own name.
 *
 * A visitor who cannot read the page has to find this without reading, and
 * the globe is the one control every web user recognises regardless of
 * language. Each language is written in its own name, never as a flag —
 * flags are countries, and Chinese alone spans three. Choosing navigates to
 * the same path under the other prefix.
 *
 * When there is no room for a separate currency control, include its
 * submenu. The wide header renders CurrencySwitch beside this menu instead.
 */
export function LanguageSwitch({
  compact = false,
  includeCurrency = true,
}: {
  compact?: boolean;
  includeCurrency?: boolean;
}) {
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
          collisionPadding={12}
          className="modal-pop z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-52 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <Suspense fallback={null}><LanguageItems path={path} /></Suspense>
          {includeCurrency && (
            <>
              <DM.Separator className="my-1.5 h-px bg-gray-100 dark:bg-gray-800" />
              <CurrencySubmenu />
            </>
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** One row per language, each in its own name, the current one ticked. The
 *  list itself, shared by the desktop globe menu and the phone's submenu. */
export function LanguageItems({ path }: { path: string }) {
  const locale = useLocale();
  const query = useSearchParams().toString();
  // Keep listing sort and display choices when choosing another translation.
  const target = (phaseForPath(path) || path === "/all") && query ? `${path}?${query}` : path;
  return (
    <>
      {LOCALES.map((l) => (
        <DM.Item key={l} asChild>
          <LazyLink
            href={target}
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
 * The languages, as a submenu, for the one menu that cannot afford a row
 * each: the phone's.
 *
 * Eleven languages inline made that menu 925px tall on a 647px screen — the
 * bottom of it, Telegram and Create, was simply off the end. Every language
 * added made it worse, and the list is meant to keep growing.
 *
 * The globe is on the trigger rather than the section, because that is the
 * whole reason this row has to be findable: a visitor who cannot read the
 * menu is looking for a symbol, and the globe is the one every web user
 * recognises.
 *
 * Beside it is the current language in its own name, and nothing else. The
 * word "Language" was there and came off: it is the longest thing on a row
 * in a 176px menu, and a globe followed by 日本語 has never needed a caption
 * to say what it does. The row still reports which language is in force,
 * which is the other thing a label would have been for.
 */
export function LanguageSubmenu({ path }: { path: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <DM.Sub>
      <DM.SubTrigger className={MENU_ITEM} aria-label={t("Language")}>
        <span className="flex min-w-0 items-center gap-2">
          <Globe />
          <span className="truncate">{LOCALE_INFO[locale].native}</span>
        </span>
        <span aria-hidden className="text-gray-400">
          ›
        </span>
      </DM.SubTrigger>
      <DM.Portal>
        {/* Overlapping its parent, on purpose.

            A submenu opens to the right of its parent and flips to the left
            when the right is full. On a 390px screen BOTH are full — a 192px
            panel beside a 192px panel wants 384px of the 370 there are — so
            the flipped one hung 22px off the edge of the screen. Radix does
            not correct that: it flips the side, it does not slide along it,
            and a submenu cannot be told to open downward instead.

            So it is pulled back over its parent by more than its own
            overhang. A phone menu covering the rows behind it is ordinary; a
            panel half off the screen is not. */}
        <DM.SubContent
          sideOffset={-48}
          alignOffset={-6}
          collisionPadding={12}
          className="modal-pop z-50 max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height,20rem))] w-48 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <Suspense fallback={null}><LanguageItems path={path} /></Suspense>
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

/**
 * The currency, as a submenu: "Currency · JPY ▸" opens the currency codes.
 * Language selection supplies the default; this list is an explicit override.
 */
export function CurrencySubmenu({ overlap = false }: { overlap?: boolean } = {}) {
  const t = useT();
  const { code } = useCurrency();
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
          /* See LanguageSubmenu: on a phone the submenu has to cover its
             parent rather than hang off the screen. */
          sideOffset={overlap ? -48 : 6}
          alignOffset={-6}
          collisionPadding={12}
          className="modal-pop z-50 max-h-80 w-44 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <CurrencyItems />
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

/** A visible currency choice beside the language control on wide screens. */
export function CurrencySwitch() {
  const t = useT();
  const { code } = useCurrency();
  return (
    <DM.Root>
      <DM.Trigger
        aria-label={`${t("Currency")}: ${code}`}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100"
      >
        <span>{code}</span>
        <span aria-hidden>▾</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="modal-pop z-50 max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height,20rem))] w-44 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <CurrencyItems />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function CurrencyItems() {
  const { code } = useCurrency();
  const item = `${MENU_ITEM} text-xs`;
  return (
    <>
      {CURRENCIES.map((c) => (
        <DM.Item key={c} className={item} onSelect={() => setCurrency(c)}>
          {c}
          {c === code && <Tick />}
        </DM.Item>
      ))}
    </>
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
