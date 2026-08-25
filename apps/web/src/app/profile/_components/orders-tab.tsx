"use client";

import useSWR from "swr";
import { commasRaw, price as formatPrice } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { fetchJson } from "@/lib/client";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { ratio, type Raw } from "@/lib/numeric";

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
  const compose = useCompose();
  const { data: orders, mutate } = useSWR<OpenOrder[]>(
    `${COUNTERPARTY_API_BASE}/addresses/${encodeURIComponent(address)}/orders?status=open&limit=100`,
    async (url: string) => (await fetchJson(url)).result as OpenOrder[],
    { refreshInterval: 15_000 },
  );
  const busy = isBusy(compose.status);

  if (!orders) return <p className="p-6 text-center text-sm text-gray-400">Loading orders…</p>;
  if (orders.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-gray-500">
        No open orders. Limit orders you place rest on the book until they fill or expire.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-gray-100">
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
                    <span className={buying ? "font-medium text-green-700" : "font-medium text-red-600"}>
                      {buying ? "Buy" : "Sell"}
                    </span>{" "}
                    <a href={`/${token}`} className="font-medium hover:text-purple-700 hover:underline">
                      {token}
                    </a>{" "}
                    {commasRaw(tokens)} @ {formatPrice(ratio(xcp, tokens))}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-gray-700">Swap</span>{" "}
                    {commasRaw(o.give_quantity)} {o.give_asset} → {commasRaw(o.get_quantity)} {o.get_asset}
                  </>
                )}
                <span className="ml-2 text-xs text-gray-500">
                  {(filled * 100).toFixed(0)}% filled ·{" "}
                  {o.expire_index === null ? "GTC" : `expires block ${o.expire_index.toLocaleString()}`}
                </span>
              </div>
              {canCancel && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => compose.composeCancel({ offer_hash: o.tx_hash })}
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-red-400 hover:text-red-600 disabled:opacity-50"
                >
                  {busy ? "…" : "Cancel"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {compose.status === "confirmed" && (
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-green-700">
          Cancel broadcast — the remainder refunds when it confirms.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              compose.reset();
              mutate();
            }}
          >
            Refresh
          </button>
        </p>
      )}
    </div>
  );
}
