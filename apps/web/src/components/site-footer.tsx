"use client";

import { usePathname, useRouter } from "next/navigation";
import { Globe, rememberLocale } from "@/components/language-switch";
import { NumberPreference } from "@/components/number-preference";
import { LazyLink } from "@/components/lazy-link";
import { TELEGRAM_URL } from "@/components/telegram-chip";
import { CURRENCIES, type Currency, setCurrency, useCurrency } from "@/lib/currency";
import { useLocale, useMachineDrafted, useT } from "@/lib/i18n/client";
import { LOCALE_INFO, LOCALES, type Locale, localePath, splitLocale } from "@/lib/i18n/locales";

/**
 * The homepage footer: the site's name, the rate its fiat figures
 * are quoted at, and — on a locale that is still mostly the model's draft —
 * an honest note with the English one click away.
 *
 * On a phone the language and currency pickers sit here too. The header's
 * globe menu is where they live on a desktop, but on a phone that menu is
 * folded into the burger, and someone who landed on the wrong language is
 * not going to open a burger to find out whether the site speaks theirs.
 * The footer is where every site keeps this, so it is where a reader looks.
 */
export function SiteFooter() {
  const t = useT();
  const pathname = usePathname();
  const machine = useMachineDrafted();
  const { code, date } = useCurrency();
  if (splitLocale(pathname).path !== "/") return null;

  return (
    <footer className="mx-auto max-w-5xl px-4 pb-24 pt-4">
      <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
        <FooterSettings />
        <div className="flex flex-col gap-3 nav:flex-row-reverse nav:items-center nav:justify-between">
          <NumberPreference />
          {/* Reference links remain easy to find after browsing the launches. */}
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LazyLink href="/faq" className="hover:text-gray-600 dark:hover:text-gray-300">
              {t("FAQ")}
            </LazyLink>
            <LazyLink href="/docs" className="hover:text-gray-600 dark:hover:text-gray-300">
              {t("Docs")}
            </LazyLink>
            <LazyLink href="/stats" className="hover:text-gray-600 dark:hover:text-gray-300">
              {t("Stats")}
            </LazyLink>
            <LazyLink href="/activity" className="hover:text-gray-600 dark:hover:text-gray-300">
              {t("Activity")}
            </LazyLink>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t("XCP.FUN on Telegram")}
              className="hover:text-gray-600 dark:hover:text-gray-300"
            >
              {t("Telegram")}
            </a>
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span>
            xcp.fun · {t("XCP-69 launches on Counterparty")}
            {machine && (
              <>
                {" · "}
                {t("Translated automatically")}
                {" · "}
                <LazyLink
                  href={splitLocale(pathname).path}
                  locale="en"
                  lang="en"
                  hrefLang="en"
                  onClick={() => rememberLocale("en")}
                  className="underline underline-offset-2"
                >
                  English
                </LazyLink>
              </>
            )}
          </span>
          {code !== "USD" && date && (
            <span>{t("{code} at the ECB reference rate for {date}", { code, date })}</span>
          )}
        </div>
      </div>
    </footer>
  );
}

/** Native selects, because on a phone the platform's own picker beats any
 *  menu the page could draw. Hidden at the width where the header has the
 *  globe menu, so the same choice is never offered twice on one screen. */
function FooterSettings() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { code, auto, detected } = useCurrency();
  const select =
    "rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300";
  return (
    <div className="flex flex-wrap items-center gap-3 lg:hidden">
      <label className="flex items-center gap-1.5">
        <Globe />
        <span className="sr-only">{t("Language")}</span>
        <select
          className={select}
          value={locale}
          onChange={(e) => {
            const next = e.target.value as Locale;
            rememberLocale(next);
            router.push(localePath(next, splitLocale(pathname).path));
          }}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={LOCALE_INFO[l].tag}>
              {LOCALE_INFO[l].native}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">{t("Currency")}</span>
        <select
          className={select}
          value={auto ? "auto" : code}
          onChange={(e) => setCurrency(e.target.value as Currency | "auto")}
        >
          <option value="auto">{t("Auto ({code})", { code: detected })}</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
