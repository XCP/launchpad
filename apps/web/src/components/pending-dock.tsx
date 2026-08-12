"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  dismissPending,
  type PendingItem,
  readPending,
  readPendingServer,
  subscribePending,
  sweepResolved,
  updatePending,
} from "@/lib/pending";
import { useWallet } from "@/lib/wallet/wallet-context";
import { big, parseJsonLossless, type Raw } from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

const POLL_MS = 30_000;

/** How long a finished action stays on screen before retiring itself. Long
 *  enough to be read, short enough that the dock is about what's happening
 *  now rather than what happened earlier. */
const RESOLVED_TTL_MS = 90_000;

/** Rows rendered before the list scrolls instead of growing. */
const MAX_ROWS = 6;

/**
 * Requests one poll tick may spend, oldest-unresolved first.
 *
 * Each unresolved item costs one Counterparty request per tick, so a wallet
 * that stacked a dozen actions would fire a dozen serial requests every 30
 * seconds. The cap bounds that: anything past it is simply picked up on a
 * later tick, which costs a little latency on the least urgent items and
 * nothing else.
 */
const MAX_POLLS_PER_TICK = 8;

/**
 * The pending dock: bottom-right pill that survives navigation, tracking
 * every broadcast action to its real outcome in block terms. Blocks are the
 * honest unit — a state change roughly every ten minutes, not a spinner
 * pretending.
 *
 * Bottom RIGHT because the presence badge sits bottom-left; the two are
 * different kinds of thing (the site's pulse vs. your own money moving) and
 * sharing a corner made them read as one widget.
 */
export function PendingDock() {
  const { status, address } = useWallet();
  const items = useSyncExternalStore(
    subscribePending,
    readPending,
    readPendingServer,
  );
  const [open, setOpen] = useState(false);

  // Retire finished actions on a timer of their own. Tied to the poll loop it
  // would stop the moment everything resolved — which is exactly when the
  // sweep still has work left to do.
  useEffect(() => {
    sweepResolved(RESOLVED_TTL_MS);
    const t = setInterval(() => sweepResolved(RESOLVED_TTL_MS), 15_000);
    return () => clearInterval(t);
  }, [items]);

  // Poll unresolved items: orders resolve through their lifecycle; other
  // kinds resolve when the transaction is parsed into a block.
  useEffect(() => {
    if (items.every((i) => i.resolved)) return;
    let stop = false;
    const poll = async () => {
      // Oldest first: the longest-waiting action is the one someone is
      // actually wondering about.
      const due = items
        .filter((i) => !i.resolved)
        .sort((a, b) => a.addedAt - b.addedAt)
        .slice(0, MAX_POLLS_PER_TICK);
      for (const item of due) {
        if (stop) break;
        try {
          if (item.kind === "order") {
            const res = await fetch(
              `${COUNTERPARTY_API_BASE}/orders/${item.txid}`,
              { signal: AbortSignal.timeout(10_000) },
            );
            if (!res.ok) continue;
            // Lossless: the partial-fill test below compares two 64-bit
            // quantities, and a fill smaller than the gap between doubles at
            // their magnitude would read as no fill at all.
            const o = parseJsonLossless<{
              result?: {
                status?: string;
                give_remaining?: Raw;
                give_quantity?: Raw;
              } | null;
            }>(await res.text()).result;
            if (!o) continue;
            if (o.status === "filled") updatePending(item.txid, { resolved: "filled" });
            else if (o.status === "expired")
              updatePending(item.txid, { resolved: "expired · refunded" });
            else if (o.status === "cancelled")
              updatePending(item.txid, { resolved: "cancelled" });
            else if (big(o.give_remaining) < big(o.give_quantity))
              updatePending(item.txid, { resolved: "partially filled · resting" });
          } else {
            // Three-state oracle: 404 = unknown, block_hash "mempool" =
            // pending, real block = confirmed. Only authoritative 404s
            // count as misses (network errors never do), only after a 60s
            // propagation grace, and only 3 CONSECUTIVE misses mark a drop.
            const res = await fetch(
              `${COUNTERPARTY_API_BASE}/transactions/${item.txid}`,
              { signal: AbortSignal.timeout(10_000) },
            );
            if (res.status === 404) {
              if (Date.now() - item.addedAt > 60_000) {
                const misses = (item.misses ?? 0) + 1;
                if (misses >= 3)
                  updatePending(item.txid, {
                    resolved: "dropped — nothing was spent",
                    misses,
                  });
                else updatePending(item.txid, { misses });
              }
              continue;
            }
            if (!res.ok) continue;
            const t = (await res.json()).result;
            if (!t?.block_index || t.block_hash === "mempool") {
              if (item.misses) updatePending(item.txid, { misses: 0 });
              continue;
            }
            if (t?.block_index)
              updatePending(item.txid, {
                resolved:
                  item.kind === "mint"
                    ? "confirmed · escrowed"
                    : item.kind === "dispense"
                      ? "confirmed · XCP delivered"
                      : item.kind === "launch"
                        ? // Confirming is not opening: a launch is announced
                          // on-chain first and stays shut until its start
                          // block, which is the whole point of the standard.
                          "confirmed · announced"
                        : "confirmed",
              });
          }
        } catch {
          // transient — next poll retries
        }
      }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [items]);

  // The dock is an extension of the connected wallet: no wallet, no dock.
  // Polling above keeps running regardless, so resolutions are already
  // recorded the moment the user reconnects. Items are scoped to the
  // active account — a switch hides the other account's activity rather
  // than blending two histories.
  if (status !== "connected") return null;
  const visible = items.filter((i) => !i.address || i.address === address);
  if (visible.length === 0) return null;

  // Pending first, then whatever just finished — the dock is sorted by what
  // still needs an answer, not by when it was started.
  const pending = visible.filter((i) => !i.resolved);
  const settled = visible.filter((i) => i.resolved);
  const ordered = [...pending, ...settled];
  const shown = ordered.slice(0, MAX_ROWS);
  const overflow = ordered.length - shown.length;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open ? (
        <div className="modal-pop w-80 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-xs font-semibold text-gray-900">
              {pending.length > 0
                ? `${pending.length} pending`
                : "Recently confirmed"}
            </span>
            <div className="flex items-center gap-1">
              {settled.length > 0 && (
                <button
                  type="button"
                  onClick={() => settled.forEach((i) => dismissPending(i.txid))}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  Clear done
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse"
                className="flex size-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>
          {/* Capped height rather than an unbounded list: a wallet that
              stacked a dozen actions would otherwise grow a panel taller than
              the viewport, with the newest rows off-screen. */}
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {shown.map((item) => (
              <DockRow key={item.txid} item={item} />
            ))}
          </ul>
          {overflow > 0 && (
            // Not "more waiting": the hidden tail is pending-then-settled, so
            // some of it has already finished. Scroll reaches all of it.
            <p className="px-1 pt-2 text-[11px] text-gray-400">
              +{overflow} more below.
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-xs font-medium text-gray-700 shadow-lg backdrop-blur transition-all hover:border-gray-300 active:scale-95"
        >
          {pending.length > 0 ? (
            <>
              <span className="size-2 animate-pulse rounded-full bg-purple-500" />
              {pending.length} pending
            </>
          ) : (
            <>
              <span className="size-2 rounded-full bg-green-500" />
              {settled.length === 1 ? "Confirmed" : `${settled.length} confirmed`}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function DockRow({ item }: { item: PendingItem }) {
  return (
    <li className="flex items-center gap-2 rounded-xl bg-gray-50 px-2.5 py-2 text-xs">
      <span
        className={`size-2 shrink-0 rounded-full ${
          item.resolved ? "bg-green-500" : "animate-pulse bg-purple-500"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-900">
          {item.label}
        </span>
        <a
          href={`https://xcp.io/tx/${item.txid}`}
          target="_blank"
          rel="noreferrer"
          className="text-gray-400 hover:text-purple-600 hover:underline"
        >
          {item.resolved ?? "in the mempool — waiting for a block"}
        </a>
      </span>
      <button
        type="button"
        onClick={() => dismissPending(item.txid)}
        aria-label="Dismiss"
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-gray-200 hover:text-gray-600"
      >
        ✕
      </button>
    </li>
  );
}
