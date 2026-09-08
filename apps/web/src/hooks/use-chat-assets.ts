"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSearchIndex } from "@/lib/api/launchpad-api";
import { chatAssetIndex, parseChatCashtags } from "@/lib/chat-assets";

// Shared with the profile's launch membership lookup, not one key per tag.
const INDEX_KEY = "xcp69-pool-membership";
async function fetchIndex() {
  const index = await fetchSearchIndex();
  if (index === null) throw new Error("Launch index unavailable");
  return index;
}

/** Lazy, shared membership lookup. Unknown tags remain plain text, including
 * during an outage. No Counterparty fallback, per-tag reads or polling. */
export function useChatAssetLinks(messages: readonly { text: string }[]): ReadonlyMap<string, string> {
  const requested = useMemo(() => new Set(messages.flatMap((message) =>
    parseChatCashtags(message.text).map((tag) => tag.asset))), [messages]);
  // XCP is the site's funding asset and has its own existing acquisition page;
  // mentioning it alone does not require consulting the launch index.
  const needsIndex = [...requested].some((asset) => asset !== "XCP");
  const { data } = useSWR(needsIndex ? INDEX_KEY : null, fetchIndex, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
    dedupingInterval: 600_000,
    errorRetryCount: 1,
    errorRetryInterval: 30_000,
  });
  const index = useMemo(() => chatAssetIndex(data), [data]);
  return useMemo(() => new Map([...requested].flatMap((asset) => {
    const href = asset === "XCP" ? "/dispense" : index.get(asset);
    return href ? [[asset, href] as const] : [];
  })), [requested, index]);
}
