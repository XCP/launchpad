"use client";

import useSWR from "swr";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/** Parsed chain height shared by launch clocks. Poll every three minutes,
 * tightening to 30 seconds within three blocks of the target. */
export function useChainHeight(targetBlock: number, initialHeight: number) {
  const { data } = useSWR(
    targetBlock > 0 ? "cp-height" : null,
    () =>
      fetchJson(`${COUNTERPARTY_API_BASE}/`).then(
        (d: { result: { counterparty_height: number } }) =>
          d.result.counterparty_height,
      ),
    {
      refreshInterval: (latest) =>
        targetBlock - (latest ?? initialHeight) <= 3 ? 30_000 : 180_000,
      revalidateOnFocus: true,
      fallbackData: initialHeight,
    },
  );
  return data ?? initialHeight;
}
