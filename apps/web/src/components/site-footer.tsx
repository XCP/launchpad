"use client";

import { CURRENCIES, type Currency, setCurrency, useCurrency } from "@/lib/currency";

/**
 * The one control that belongs at the bottom of every page: which currency
 * the site's fiat figures are shown in.
 *
 * Not in the header, which is for things used on every visit; this is set
 * once, if ever, because the default is what the browser's locale implies.
 * The select shows that detection as its "Auto" entry, so a visitor can see
 * why they are looking at yen before deciding whether to change it.
 */
export function SiteFooter() {
  const { code, auto, detected, date } = useCurrency();
  return (
    <footer className="mx-auto max-w-5xl px-4 pb-24 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-200 pt-4 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
        <span>
          xcp.fun · XCP-69 launches on Counterparty
        </span>
        <label className="flex items-center gap-2">
          <span title={date ? `ECB reference rate for ${date}` : undefined}>Prices in</span>
          <select
            value={auto ? "auto" : code}
            onChange={(event) => {
              const next = event.target.value;
              setCurrency(next === "auto" ? "auto" : (next as Currency));
            }}
            aria-label="Currency for prices"
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <option value="auto">Auto ({detected})</option>
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
      </div>
    </footer>
  );
}
