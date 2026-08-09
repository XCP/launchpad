"use client";

import useSWR from "swr";
import { compact, shortAddress, tokenQty } from "@/lib/format";
import { big, parseJsonLossless, type Raw, ratio, sumRaw } from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Live sale progress with a mempool overlay: solid segment = confirmed
 * (consensus), shimmering segment = valid mints currently in the mempool.
 *
 * Unconfirmed is provisional BY DESIGN: mempool parsing validates each batch
 * against confirmed state only, so pending mints can cumulatively exceed the
 * remaining supply, be replaced (RBF), or simply never confirm — and core
 * emits mempool NEW_FAIRMINT events for invalid mints too. So we filter to
 * status "valid", cap the display at 100%, and never let pending feed any
 * conformance or sold-out determination. Consensus decides; this foreshadows.
 */

interface PendingMint {
  txHash: string;
  source: string;
  quantity: Raw;
}

interface Live {
  earned: Raw;
  pending: PendingMint[];
}

interface MempoolEvent {
  tx_hash: string;
  params: {
    fairminter_tx_hash?: string;
    source?: string;
    earn_quantity?: Raw;
    status?: string;
  };
}

async function fetchLive(fairminterTxHash: string): Promise<Live> {
  const [fmRes, memRes] = await Promise.all([
    fetch(`${COUNTERPARTY_API_BASE}/fairminters/${fairminterTxHash}`, {
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${COUNTERPARTY_API_BASE}/mempool/events/NEW_FAIRMINT?limit=1000`, {
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  if (!fmRes.ok || !memRes.ok) throw new Error("live fetch failed");
  // Lossless on both: earned_quantity is what the whole bar is a fraction of.
  const earned: Raw =
    parseJsonLossless<{ result?: { earned_quantity?: Raw } }>(await fmRes.text())
      .result?.earned_quantity ?? 0;
  const events: MempoolEvent[] =
    parseJsonLossless<{ result?: MempoolEvent[] }>(await memRes.text()).result ?? [];
  const pending = events
    .filter(
      (e) =>
        e.params?.fairminter_tx_hash === fairminterTxHash &&
        e.params?.status === "valid",
    )
    .map((e) => ({
      txHash: e.tx_hash,
      source: e.params.source ?? "",
      quantity: e.params.earn_quantity ?? 0,
    }));
  return { earned, pending };
}

export function LiveProgress({
  fairminterTxHash,
  initialEarned,
  target,
  allOrNothing,
  divisible,
}: {
  fairminterTxHash: string;
  initialEarned: Raw;
  target: Raw;
  allOrNothing: boolean;
  divisible: boolean;
}) {
  // Until the first poll resolves, render exactly what the server rendered.
  // Two requests per tick, one of them a 1,000-event mempool scan — 10s
  // still feels live for a mint that fills over hours, at half the load.
  const { data } = useSWR(fairminterTxHash, fetchLive, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
  const earned = data?.earned ?? initialEarned;
  const pending = data?.pending ?? [];
  // Exact sum, then a percentage: the operands are 64-bit quantities, the
  // result is a fraction of a progress bar.
  const pendingSum = sumRaw(pending.map((p) => p.quantity));
  const confirmedPct = Math.min(100, ratio(earned, target) * 100);
  const pendingPct = Math.min(100 - confirmedPct, ratio(pendingSum, target) * 100);

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-lg font-bold">{confirmedPct.toFixed(1)}%</span>
        <span className="text-sm text-gray-500">
          {compact(tokenQty(earned, divisible))} /{" "}
          {big(target) > 0n ? compact(tokenQty(target, divisible)) : "∞"}
          {allOrNothing ? " · sells out or refunds" : ""}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
        <div className="flex h-full">
          <div
            className="h-full bg-purple-600 transition-[width] duration-700"
            style={{ width: `${confirmedPct}%` }}
          />
          {pendingPct > 0 && (
            <>
              {/* 2px surface gap so the segments read as two quantities */}
              <div className="h-full w-0.5 shrink-0 bg-white" />
              <div
                className="h-full animate-pulse bg-purple-400 transition-[width] duration-700"
                style={{ width: `${pendingPct}%` }}
              />
            </>
          )}
        </div>
      </div>
      {pendingSum > 0n && (
        <div className="mt-2 text-xs text-gray-500">
          <p>
            +{pendingPct.toFixed(1)}% in the mempool — {pending.length}{" "}
            unconfirmed {pending.length === 1 ? "mint" : "mints"}, counted only
            when they confirm.
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-gray-400">
            {pending.slice(0, 5).map((p) => (
              <li key={p.txHash} className="flex justify-between">
                <span>{shortAddress(p.source)}</span>
                <span>{compact(tokenQty(p.quantity, divisible))} pending</span>
              </li>
            ))}
            {pending.length > 5 && <li>…and {pending.length - 5} more</li>}
          </ul>
        </div>
      )}
    </>
  );
}
