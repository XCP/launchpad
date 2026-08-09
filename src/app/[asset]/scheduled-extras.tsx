"use client";

import useSWR from "swr";
import { fetchJson } from "@/lib/client";
import { blocksEta } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Live countdown for a scheduled launch. Lazy until it matters: polls the
 * chain height every 2 minutes, tightening to 30s inside the final 12
 * blocks so the last stretch reads like a countdown, not a cached page.
 */
export function OpensCountdown({
  startBlock,
  initialHeight,
}: {
  startBlock: number;
  initialHeight: number;
}) {
  const { data } = useSWR(
    "cp-height",
    () =>
      fetchJson(`${COUNTERPARTY_API_BASE}/`).then(
        (d: { result: { counterparty_height: number } }) =>
          d.result.counterparty_height,
      ),
    {
      refreshInterval: (latest) =>
        startBlock - (latest ?? initialHeight) <= 12 ? 30_000 : 120_000,
      fallbackData: initialHeight,
    },
  );
  const height = data ?? initialHeight;
  const remaining = startBlock - height;

  if (remaining <= 0) {
    return (
      <>
        <div className="text-4xl font-bold text-gray-900">open</div>
        <div className="mt-1 text-sm text-gray-500">
          minting is live — refresh the page
        </div>
      </>
    );
  }
  return (
    <>
      <div className="text-4xl font-bold tabular-nums text-gray-900">
        {remaining <= 12
          ? `${remaining} block${remaining === 1 ? "" : "s"}`
          : blocksEta(remaining)}
      </div>
      <div className="mt-1 text-sm text-gray-500">
        {remaining <= 12
          ? `${blocksEta(remaining)} until minting opens · block ${startBlock.toLocaleString()}`
          : `until minting opens · block ${startBlock.toLocaleString()}`}
      </div>
    </>
  );
}

/** Description text for launches whose on-chain description is our hosted
 *  metadata JSON — fetch it and show the human words inside. */
export function HostedDescription({ url }: { url: string }) {
  const { data } = useSWR(url, (u: string) =>
    fetchJson(u).catch(() => null),
  );
  const text =
    data && typeof data.description === "string" ? data.description : null;
  if (!text) return null;
  return (
    <p className="mt-3 text-sm leading-relaxed text-gray-600">{text}</p>
  );
}
