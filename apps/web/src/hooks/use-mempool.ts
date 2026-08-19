"use client";

import useSWR from "swr";
import { fetchMempoolSnapshot, type MempoolSnapshot } from "@/lib/api/launchpad-api";

/** One SWR key for the whole site, so the header chip and the page share a
 *  single poll instead of running two. */
const KEY = "mempool";

/** Long enough that a burst of navigation doesn't refetch, short enough that
 *  it never suppresses a real refresh. */
const DEDUPE_MS = 2_000;

/**
 * The unconfirmed view of the chain, filtered to what this site covers.
 *
 * Everything here now arrives pre-filtered from /v2/mempool. It used to be
 * assembled in the browser: two Counterparty mempool requests, plus a download
 * of the whole launch index to learn which assets counted, plus the XCP-69
 * predicate run over the results — all of it repeated independently by every
 * open tab, because the header chip carries this poll and the header is on
 * every page. At a hundred visitors that is invisible; at a thousand it is
 * ~66 requests a second aimed at a public Counterparty node. This is the same
 * consolidation LaunchRoom already made for the asset page, applied site-wide.
 *
 * The verdict has not moved, only where it runs: apps/api judges with the same
 * shared predicate this file used to call, so the chip and the page still
 * cannot disagree — and now neither can two browsers.
 *
 * `refreshMs` still differs by caller on purpose: the page is being watched
 * and wants to be current, the header chip is ambient and does not. Both share
 * the key, so on /mempool the two collapse into one poll at the faster rate
 * rather than adding up. The server's own cache means asking more often is no
 * longer the same as asking Counterparty more often.
 */
export function useMempool(refreshMs: number) {
  const { data, isLoading, mutate } = useSWR<MempoolSnapshot | null>(
    KEY,
    fetchMempoolSnapshot,
    {
      refreshInterval: refreshMs,
      dedupingInterval: DEDUPE_MS,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  return {
    fairminters: data?.fairminters ?? [],
    mints: data?.mints ?? [],
    orders: data?.orders ?? [],
    fetchedAt: data?.fetchedAt ?? null,
    isLoading: isLoading && !data,
    refresh: () => mutate(),
  };
}
