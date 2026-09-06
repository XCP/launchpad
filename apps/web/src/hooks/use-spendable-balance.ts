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
    // Thirty seconds, not fifteen: this read exists to catch the node's own
    // view of a just-broadcast spend, and pending.ts already subtracts what
    // THIS browser broadcast the moment it happens. Halving the cadence
    // costs nothing visible and removes two Counterparty calls a minute from
    // every surface that shows a balance.
    { refreshInterval: 30_000, dedupingInterval: 5_000 },
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
    /**
     * The read has failed and nothing older is cached to show instead.
     *
     * Surfaces treat this as "proceed without a balance", not as "wait". A
     * balance here is a courtesy check ahead of the one consensus runs anyway;
     * compose returns a specific error when it is short. Gating the button on
     * this read meant a throttled browser could not transact at all, even
     * though composing is the one call exempt from the relay's budget — and a
     * dead button is what sent people refreshing, which is what keeps the
     * throttle alive.
     */
    balanceUnavailable: confirmed.data === undefined && confirmed.error !== undefined,
    pendingError: pending.error as Error | undefined,
    isLoading: confirmed.isLoading,
    refresh: async () => {
      await Promise.all([confirmed.mutate(), pending.mutate()]);
    },
  };
}
