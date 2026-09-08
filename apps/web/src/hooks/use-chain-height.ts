"use client";

import useSWR from "swr";
import { useRef } from "react";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { fetchBlockHeight } from "@/lib/api/counterparty";

/** Parsed chain height shared by launch clocks. Poll every three minutes,
 * tightening to 30 seconds within three blocks of the target. */
export function useChainHeight(targetBlock: number, initialHeight: number) {
  const latestHeight = useRef(initialHeight);
  const { data } = useSWR(
    targetBlock > 0 ? "cp-height" : null,
    async () => {
      // Distant clocks need indexed height. Near their target, ask the live
      // parser so opening or expiry is not delayed by a lagging mirror.
      const height = targetBlock - latestHeight.current > 3
        ? await fetchBlockHeight()
        : (await fetchJson(`${COUNTERPARTY_API_BASE}/`)).result.counterparty_height;
      if (!Number.isSafeInteger(height) || height <= 0) throw new Error("Invalid chain height");
      latestHeight.current = height;
      return height as number;
    },
    {
      refreshInterval: (latest) =>
        targetBlock - (latest ?? initialHeight) <= 3 ? 30_000 : 180_000,
      revalidateOnFocus: true,
      fallbackData: initialHeight,
    },
  );
  return data ?? initialHeight;
}
