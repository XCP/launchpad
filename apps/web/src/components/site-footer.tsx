"use client";

import { LazyLink } from "@/components/lazy-link";
import { useCurrency } from "@/lib/currency";
import { useMachineDrafted, useT } from "@/lib/i18n/client";

/**
 * The bottom line of every page: the site's name, the rate its fiat figures
 * are quoted at, and — on a locale that is still mostly the model's draft —
 * an honest note with the English one click away. Language and currency
 * are chosen in the header's globe menu; this only reports.
 */
export function SiteFooter() {
  const t = useT();
  const machine = useMachineDrafted();
  const { code, date } = useCurrency();
  return (
    <footer className="mx-auto max-w-5xl px-4 pb-24 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-200 pt-4 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
        <span>
          xcp.fun · {t("XCP-69 launches on Counterparty")}
          {machine && (
            <>
              {" · "}
              {t("Translated automatically")}
              {" · "}
              <LazyLink href="/" locale="en" className="underline underline-offset-2">
                English
              </LazyLink>
            </>
          )}
        </span>
        {code !== "USD" && date && (
          <span>{t("{code} at the ECB reference rate for {date}", { code, date })}</span>
        )}
      </div>
    </footer>
  );
}
