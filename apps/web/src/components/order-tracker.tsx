"use client";

import useSWR from "swr";
import { parseJsonLossless, type Raw, ratio } from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";

interface OrderRow {
  status: string;
  give_asset: string;
  give_quantity: Raw;
  give_remaining: Raw;
  get_asset: string;
  get_quantity: Raw;
  get_remaining: Raw;
  expire_index: number | null;
}

/**
 * Counterparty orders fail OPEN: an unfilled remainder doesn't revert, it
 * rests on the book with funds escrowed. So a broadcast isn't the end of
 * the story — track the order to its real outcome (filled / resting /
 * expired) and surface cancel while any remainder is open.
 */
export function OrderTracker({
  txHash,
  onCancel,
  busy,
}: {
  txHash: string;
  onCancel?: (hash: string) => void;
  busy?: boolean;
}) {
  const num = useNumbers();
  const { data: order } = useSWR<OrderRow | null>(
    `${COUNTERPARTY_API_BASE}/orders/${txHash}`,
    async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      return (
        parseJsonLossless<{ result?: OrderRow | null }>(await res.text())
          .result ?? null
      );
    },
    { refreshInterval: 15_000 },
  );

  const t = useT();

  if (!order) {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
        <span className="size-2 animate-pulse rounded-full bg-green-500" />
        {t("In the mempool — matching runs the moment the block lands.")}
      </p>
    );
  }

  const filledPct = Math.max(
    0,
    Math.min(100, (1 - ratio(order.give_remaining, order.give_quantity)) * 100),
  );

  if (order.status === "filled") {
    return (
      <p className="mt-2 text-sm font-medium text-green-700 dark:text-green-400">✓ {t("Filled")}</p>
    );
  }
  if (order.status === "expired") {
    return (
      <p className="mt-2 text-sm text-green-700 dark:text-green-400">
        {t("Expired — the unfilled {amount} {asset} was refunded automatically.", {
          amount: num.commasRaw(order.give_remaining),
          asset: order.give_asset,
        })}
      </p>
    );
  }
  if (order.status === "cancelled") {
    return <p className="mt-2 text-sm text-green-700 dark:text-green-400">{t("Cancelled — funds refunded.")}</p>;
  }

  return (
    <div className="mt-2 text-sm text-green-700 dark:text-green-400">
      <p>
        {filledPct > 0
          ? t("{pct}% filled — the rest is resting on the book with {amount} {asset} escrowed.", {
              pct: filledPct.toFixed(0),
              amount: num.commasRaw(order.give_remaining),
              asset: order.give_asset,
            })
          : t("Confirmed — resting on the book with {amount} {asset} escrowed.", {
              amount: num.commasRaw(order.give_remaining),
              asset: order.give_asset,
            })}
      </p>
      {onCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onCancel(txHash)}
          className="mt-1.5 rounded-md border border-green-300 dark:border-green-700 px-2.5 py-1 text-xs font-medium text-green-800 dark:text-green-300 hover:border-red-400 dark:hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
        >
          {t("Cancel remainder")}
        </button>
      )}
    </div>
  );
}
