"use client";

import useSWR from "swr";
import {
  fetchMempoolFairminters,
  fetchMempoolFairmints,
  type MempoolMint,
} from "@/lib/api/counterparty";
import { isXcp69, type Fairminter } from "@/lib/xcp69";

/** One SWR key for the whole site, so the header chip and the page share a
 *  single poll instead of running two. */
const KEY = "mempool";

/** Long enough that a burst of navigation doesn't refetch, short enough that
 *  it never suppresses a real refresh. */
const DEDUPE_MS = 2_000;

export interface MempoolSnapshot {
  fairminters: Fairminter[];
  mints: MempoolMint[];
  /** When this data came back, for "updated Ns ago". */
  fetchedAt: number;
}

async function load(): Promise<MempoolSnapshot> {
  const [fairminters, mints] = await Promise.all([
    fetchMempoolFairminters(),
    fetchMempoolFairmints(),
  ]);
  return { fairminters, mints, fetchedAt: Date.now() };
}

/**
 * The unconfirmed view of the chain, filtered to what this site covers.
 *
 * `refreshMs` differs by caller on purpose: the page is being watched and
 * wants to be current, the header chip is ambient and does not. Both share
 * the key, so on /mempool the two collapse into one poll at the faster rate
 * rather than adding up.
 *
 * A mempool fairminter is judged by the predicate directly — the timing
 * clause passes automatically for an unconfirmed row, which is correct: it
 * cannot have opened before it confirmed. Mints are filtered by their asset
 * against the conforming set, since a mint names a launch rather than
 * restating its terms.
 */
export function useMempool(conformingAssets: string[], refreshMs: number) {
  const { data, isLoading, mutate } = useSWR<MempoolSnapshot>(KEY, load, {
    refreshInterval: refreshMs,
    dedupingInterval: DEDUPE_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const fairminters = (data?.fairminters ?? []).filter((fm) =>
    isXcp69(fm, undefined),
  );

  // A launch still in the mempool can already have mints queued behind it, so
  // the conforming set includes what we just judged as well as what's indexed.
  const covered = new Set(conformingAssets);
  for (const fm of fairminters) covered.add(fm.asset);

  const mints = (data?.mints ?? []).filter((m) => covered.has(m.asset));

  return {
    fairminters,
    mints,
    fetchedAt: data?.fetchedAt ?? null,
    isLoading: isLoading && !data,
    refresh: () => mutate(),
  };
}
