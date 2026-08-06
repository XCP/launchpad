"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  dismissPending,
  type PendingItem,
  readPending,
  readPendingServer,
  subscribePending,
  updatePending,
} from "@/lib/pending";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const POLL_MS = 30_000;

/**
 * The persistent pending dock: bottom-left pill that survives navigation,
 * tracking every broadcast action to its real outcome in block terms.
 * Blocks are the honest unit — a state change roughly every ten minutes,
 * not a spinner pretending.
 */
export function PendingDock() {
  const items = useSyncExternalStore(
    subscribePending,
    readPending,
    readPendingServer,
  );
  const [open, setOpen] = useState(false);

  // Poll unresolved items: orders resolve through their lifecycle; other
  // kinds resolve when the transaction is parsed into a block.
  useEffect(() => {
    if (items.every((i) => i.resolved)) return;
    let stop = false;
    const poll = async () => {
      for (const item of items) {
        if (stop || item.resolved) continue;
        try {
          if (item.kind === "order") {
            const res = await fetch(
              `${COUNTERPARTY_API_BASE}/orders/${item.txid}`,
              { signal: AbortSignal.timeout(10_000) },
            );
            if (!res.ok) continue;
            const o = (await res.json()).result;
            if (!o) continue;
            if (o.status === "filled") updatePending(item.txid, { resolved: "filled" });
            else if (o.status === "expired")
              updatePending(item.txid, { resolved: "expired · refunded" });
            else if (o.status === "cancelled")
              updatePending(item.txid, { resolved: "cancelled" });
            else if (o.give_remaining < o.give_quantity)
              updatePending(item.txid, { resolved: "partially filled · resting" });
          } else {
            const res = await fetch(
              `${COUNTERPARTY_API_BASE}/transactions/${item.txid}`,
              { signal: AbortSignal.timeout(10_000) },
            );
            if (!res.ok) continue;
            const t = (await res.json()).result;
            if (!t?.block_index) {
              // Not confirmed — check the tx still exists on the Bitcoin
              // side. A 404 after a propagation grace period means it was
              // purged or replaced: the phantom subtraction must end.
              if (Date.now() - item.addedAt > 120_000) {
                const btc = await fetch(
                  `https://mempool.space/api/tx/${item.txid}`,
                  { signal: AbortSignal.timeout(10_000) },
                ).catch(() => null);
                if (btc && btc.status === 404)
                  updatePending(item.txid, {
                    resolved: "dropped — funds never left",
                  });
              }
              continue;
            }
            if (t?.block_index)
              updatePending(item.txid, {
                resolved:
                  item.kind === "mint"
                    ? "confirmed · escrowed"
                    : item.kind === "dispense"
                      ? "confirmed · XCP delivered"
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

  if (items.length === 0) return null;
  const unresolved = items.filter((i) => !i.resolved).length;

  return (
    <div className="fixed bottom-4 left-4 z-40">
      {open ? (
        <div className="modal-pop w-80 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-xs font-semibold text-gray-900">
              Activity
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Collapse"
              className="flex size-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <ul className="space-y-1.5">
            {items.map((item) => (
              <DockRow key={item.txid} item={item} />
            ))}
          </ul>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-xs font-medium text-gray-700 shadow-lg backdrop-blur transition-all hover:border-gray-300 active:scale-95"
        >
          {unresolved > 0 ? (
            <>
              <span className="size-2 animate-pulse rounded-full bg-purple-500" />
              {unresolved} pending
            </>
          ) : (
            <>
              <span className="size-2 rounded-full bg-green-500" />
              {items.length} done
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
