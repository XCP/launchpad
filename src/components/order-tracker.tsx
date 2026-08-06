"use client";

import useSWR from "swr";
import { commas } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;

interface OrderRow {
  status: string;
  give_asset: string;
  give_quantity: number;
  give_remaining: number;
  get_asset: string;
  get_quantity: number;
  get_remaining: number;
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
  const { data: order } = useSWR<OrderRow | null>(
    `${COUNTERPARTY_API_BASE}/orders/${txHash}`,
    async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      return (await res.json()).result ?? null;
    },
    { refreshInterval: 15_000 },
  );

  if (!order) {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-green-700">
        <span className="size-2 animate-pulse rounded-full bg-green-500" />
        In the mempool — matching runs the moment the block lands.
      </p>
    );
  }

  const filledPct = Math.max(
    0,
    Math.min(100, (1 - order.give_remaining / order.give_quantity) * 100),
  );

  if (order.status === "filled") {
    return (
      <p className="mt-2 text-sm font-medium text-green-700">✓ Filled</p>
    );
  }
  if (order.status === "expired") {
    return (
      <p className="mt-2 text-sm text-green-700">
        Expired — the unfilled {commas(order.give_remaining / SATS)}{" "}
        {order.give_asset} was refunded automatically.
      </p>
    );
  }
  if (order.status === "cancelled") {
    return <p className="mt-2 text-sm text-green-700">Cancelled — funds refunded.</p>;
  }

  return (
    <div className="mt-2 text-sm text-green-700">
      <p>
        {filledPct > 0 ? `${filledPct.toFixed(0)}% filled — the rest is` : "Confirmed —"}{" "}
        resting on the book with {commas(order.give_remaining / SATS)}{" "}
        {order.give_asset} escrowed.
      </p>
      {onCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onCancel(txHash)}
          className="mt-1.5 rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-800 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
        >
          Cancel remainder
        </button>
      )}
    </div>
  );
}
