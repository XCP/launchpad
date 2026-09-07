"use client";

import useSWR from "swr";
import { LazyLink } from "@/components/lazy-link";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { fetchJson } from "@/lib/client";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { ratio, type Raw } from "@/lib/numeric";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";

interface OpenOrder {
  tx_hash: string;
  give_asset: string;
  get_asset: string;
  give_quantity: Raw;
  get_quantity: Raw;
  give_remaining: Raw;
  expire_index: number | null;
}

/**
 * Every open order this address has, across all pairs.
 *
 * This view used to live on /ASSET, filtered to one pair, under a tab labelled
 * "Orders" — which put a personal holding on a page about a market and left the
 * market's own book unshown. Worse, its empty state read "No open orders on
 * this pair" while the pair had eleven live orders on the book: a sentence
 * about the reader rendered as a statement about the market.
 *
 * So the two swapped places. /ASSET/Orders is the book; this is yours, on the
 * page that is already about you, where it can also show pairs the asset page
 * would never have had a tab for.
 */
export function OrdersTab({
  address,
  canCancel,
}: {
  address: string;
  /** Only a wallet's own profile can cancel; a public one is read-only. */
  canCancel: boolean;
}) {
  const num = useNumbers();
  const t = useT();
  const compose = useCompose();
  const { data: orders, mutate } = useSWR<OpenOrder[]>(
    `${COUNTERPARTY_API_BASE}/addresses/${encodeURIComponent(address)}/orders?status=open&limit=100`,
    async (url: string) => (await fetchJson(url)).result as OpenOrder[],
    { refreshInterval: 15_000 },
  );
  const busy = isBusy(compose.status);

  if (!orders) return <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">{t("Loading orders…")}</p>;
  if (orders.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {t("No open orders. Limit orders you place rest on the book until they fill or expire.")}
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {orders.map((o) => {
          // XCP is the quote wherever it appears, so a price only means
          // something on those pairs. A token/token order is shown as the
          // exchange it literally is rather than given an invented rate.
          const buying = o.give_asset === "XCP";
          const selling = o.get_asset === "XCP";
          const token = buying ? o.get_asset : selling ? o.give_asset : null;
          const tokens = buying ? o.get_quantity : o.give_quantity;
          const xcp = buying ? o.give_quantity : o.get_quantity;
          const filled = 1 - ratio(o.give_remaining, o.give_quantity);
          return (
            <li key={o.tx_hash} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div className="min-w-0">
                {token ? (
                  <>
                    <span className={buying ? "font-medium text-green-700 dark:text-green-400" : "font-medium text-red-600 dark:text-red-400"}>
                      {buying ? t("Buy") : t("Sell")}
                    </span>{" "}
                    <LazyLink href={`/${token}`} className="font-medium hover:text-purple-700 dark:hover:text-purple-300 hover:underline">
                      {token}
                    </LazyLink>{" "}
                    {num.commasRaw(tokens)} @ {num.price(ratio(xcp, tokens))}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{t("Swap")}</span>{" "}
                    {num.commasRaw(o.give_quantity)} {o.give_asset} → {num.commasRaw(o.get_quantity)} {o.get_asset}
                  </>
                )}
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {t("{pct}% filled", { pct: (filled * 100).toFixed(0) })} ·{" "}
                  {o.expire_index === null ? "GTC" : t("expires block {n}", { n: num.commas(o.expire_index) })}
                </span>
              </div>
              {canCancel && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => compose.composeCancel({ offer_hash: o.tx_hash })}
                  className="rounded-md border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 transition-colors hover:border-red-400 dark:hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                >
                  {busy ? "…" : t("Cancel")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {compose.status === "confirmed" && (
        <p className="border-t border-gray-100 dark:border-gray-800 px-4 py-2 text-xs text-green-700 dark:text-green-400">
          {t("Cancel broadcast — the remainder refunds when it confirms.")}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              compose.reset();
              mutate();
            }}
          >
            {t("Refresh")}
          </button>
        </p>
      )}
    </div>
  );
}
