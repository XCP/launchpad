"use client";

import useSWR from "swr";
import { fetchMintsBySource } from "@/lib/api/launchpad-api";

/** The cash summary and Minting tab share one address read and cadence. */
export function useOpenMints(address: string) {
  return useSWR(
    ["open-mints", address],
    () => fetchMintsBySource(address),
    { refreshInterval: 30_000, keepPreviousData: false },
  );
}
