"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { fetchBalance, fetchPendingDebits } from "@/lib/client";
import { maxRaw } from "@/lib/numeric";
import {
  pendingSpentRaw,
  readPending,
  readPendingServer,
  subscribePending,
} from "@/lib/pending";

/**
 * A transaction-facing balance: confirmed address balance minus debits the
 * Counterparty node already sees and our own just-broadcast actions that may
 * not have propagated to that node yet.
 *
 * The mempool read is keyed only by address, so SWR collapses every asset on
 * the page into one lightweight request instead of one request per token.
 */
export function useSpendableBalance(
  address: string | null,
  asset: string | null,
  scope: string,
) {
  const pendingItems = useSyncExternalStore(
    subscribePending,
    readPending,
    readPendingServer,
  );
  const resolvedCount = pendingItems.filter((item) => item.resolved).length;

  const confirmed = useSWR(
    address && asset
      ? [address, asset, scope, "confirmed-balance", resolvedCount]
      : null,
    ([addr, token]) => fetchBalance(addr, token),
    { refreshInterval: 30_000 },
  );
  const pending = useSWR(
    address ? [address, "counterparty-pending-debits"] : null,
    ([addr]) => fetchPendingDebits(addr),
    { refreshInterval: 15_000, dedupingInterval: 5_000 },
  );

  const fromNode = asset ? pending.data?.get(asset) : undefined;
  const local = asset
    ? pendingSpentRaw(asset, address, fromNode?.txids)
    : 0n;
  const balance =
    confirmed.data === undefined
      ? undefined
      : maxRaw(
          0n,
          confirmed.data - (fromNode?.quantity ?? 0n) - local,
        );

  return {
    balance,
    confirmedBalance: confirmed.data,
    pendingOutgoing: (fromNode?.quantity ?? 0n) + local,
    balanceError: confirmed.error as Error | undefined,
    pendingError: pending.error as Error | undefined,
    isLoading: confirmed.isLoading,
    refresh: async () => {
      await Promise.all([confirmed.mutate(), pending.mutate()]);
    },
  };
}
