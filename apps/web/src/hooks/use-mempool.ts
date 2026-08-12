"use client";

import useSWR from "swr";
import {
  fetchMempoolFairminters,
  fetchMempoolFairmints,
  type MempoolMint,
} from "@/lib/api/counterparty";
import { fetchIndexedLaunches } from "@/lib/api/launchpad-api";
import { isXcp69, type Fairminter } from "@/lib/xcp69";

/** One SWR key for the whole site, so the header chip and the page share a
 *  single poll instead of running two. */
const KEY = "mempool";

/** The conforming set, cached separately: it changes far more slowly than
 *  the mempool does and both consumers need the identical answer. */
const CONFORMING_KEY = "mempool-conforming-assets";

/** Enough to name every conforming launch — this is a membership test, not a
 *  listing, so it wants the whole set rather than a page of it. */
const ALL_PHASES = 500;

async function loadConformingAssets(): Promise<string[]> {
  const indexed = await fetchIndexedLaunches(ALL_PHASES);
  return (indexed ?? []).map((l) => l.fm.asset);
}

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
export function useMempool(refreshMs: number) {
  const { data, isLoading, mutate } = useSWR<MempoolSnapshot>(KEY, load, {
    refreshInterval: refreshMs,
    dedupingInterval: DEDUPE_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  // Resolved HERE rather than passed in, so the header chip and the page it
  // links to cannot disagree. They did: the chip had no conforming set, so it
  // dropped every mint and read 2 while the page read 4 — and a badge that
  // contradicts the page one tap away is worse than no badge.
  const { data: conformingAssets } = useSWR(CONFORMING_KEY, loadConformingAssets, {
    // Which launches exist changes on a block, not on a poll.
    refreshInterval: 120_000,
    keepPreviousData: true,
  });

  const fairminters = (data?.fairminters ?? []).filter((fm) =>
    isXcp69(fm, undefined),
  );

  // A launch still in the mempool can already have mints queued behind it, so
  // the conforming set includes what we just judged as well as what's indexed.
  const covered = new Set(conformingAssets ?? []);
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
