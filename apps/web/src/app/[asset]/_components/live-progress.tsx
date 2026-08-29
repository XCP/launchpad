"use client";

import { compact, tokenQty } from "@/lib/format";
import { useLaunchRoom, useStatusTransition } from "@/app/[asset]/_components/launch-room";
import { big, type Raw, ratio, sumRaw } from "@/lib/numeric";

/**
 * Live sale progress with a mempool overlay: solid segment = confirmed
 * (consensus), shimmering segment = valid mints currently in the mempool.
 *
 * Unconfirmed is provisional BY DESIGN: mempool parsing validates each batch
 * against confirmed state only, so pending mints can cumulatively exceed the
 * remaining supply, be replaced (RBF), or simply never confirm — and core
 * emits mempool NEW_FAIRMINT events for invalid mints too. So the room
 * filters to status "valid", the bar caps its display at 100%, and pending
 * never feeds any conformance or sold-out determination. Consensus decides;
 * this foreshadows.
 *
 * Reads from the page's shared LaunchRoomProvider (one WebSocket, one poll
 * loop server-side per launch — not one per visitor) rather than polling
 * Counterparty itself; until the first message arrives, or if the socket
 * never connects, it renders exactly what the server rendered.
 */

export function LiveProgress({
  initialEarned,
  target,
  allOrNothing,
  divisible,
  serverStatus,
}: {
  initialEarned: Raw;
  target: Raw;
  allOrNothing: boolean;
  divisible: boolean;
  /** What the page was rendered against. When the room reports something
   *  else, the sale has ended and this view is stale. */
  serverStatus: string;
}) {
  const { state } = useLaunchRoom();
  // Sells out or refunds while you're watching: the page follows.
  useStatusTransition(serverStatus);
  const earned = state?.earned_quantity ?? initialEarned;
  // Exact sum, then a percentage: the operands are 64-bit quantities, the
  // result is a fraction of a progress bar. No per-mint detail rendered
  // here — the shimmering segment below IS the pending representation.
  const pendingSum = sumRaw((state?.pending ?? []).map((p) => p.quantity));
  const confirmedPct = Math.min(100, ratio(earned, target) * 100);
  const pendingPct = Math.min(100 - confirmedPct, ratio(pendingSum, target) * 100);

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-lg font-bold">{confirmedPct.toFixed(1)}%</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {compact(tokenQty(earned, divisible))} /{" "}
          {big(target) > 0n ? compact(tokenQty(target, divisible)) : "∞"}
          {allOrNothing ? " · to launch" : ""}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="flex h-full">
          <div
            className="h-full bg-purple-600 transition-[width] duration-700"
            style={{ width: `${confirmedPct}%` }}
          />
          {pendingPct > 0 && (
            <>
              {/* 2px surface gap so the segments read as two quantities */}
              <div className="h-full w-0.5 shrink-0 bg-white dark:bg-gray-900" />
              <div
                className="h-full animate-pulse bg-purple-400 transition-[width] duration-700"
                style={{ width: `${pendingPct}%` }}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
