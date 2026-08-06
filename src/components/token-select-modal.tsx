"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { commas } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;

async function fetchBalances(
  address: string,
  assets: string[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    assets.map(async (a) => {
      try {
        const res = await fetch(
          `${COUNTERPARTY_API_BASE}/addresses/${address}/balances/${a}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) return [a, 0] as const;
        const data = await res.json();
        const rows: { quantity: number }[] = Array.isArray(data.result)
          ? data.result
          : data.result
            ? [data.result]
            : [];
        return [a, rows.reduce((s, r) => s + (r.quantity ?? 0), 0)] as const;
      } catch {
        return [a, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * The token selector every swap UI ships: a modal (never a dropdown) with
 * search, 56px rows, balances right-aligned, sorted holdings-first.
 */
export function TokenSelectModal(props: {
  open: boolean;
  onClose: () => void;
  assets: string[];
  selected?: string;
  onSelect: (asset: string) => void;
  address?: string | null;
  title?: string;
  rowLabel?: (asset: string) => string;
}) {
  // Mount/unmount with `open` so search state resets naturally on close.
  if (!props.open) return null;
  return <ModalInner {...props} />;
}

function ModalInner({
  onClose,
  assets,
  selected,
  onSelect,
  address,
  title = "Select a token",
  rowLabel,
}: {
  open: boolean;
  onClose: () => void;
  assets: string[];
  selected?: string;
  onSelect: (asset: string) => void;
  address?: string | null;
  title?: string;
  rowLabel?: (asset: string) => string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: balances } = useSWR(
    address ? [address, assets.join(","), "modal-balances"] : null,
    ([addr]) => fetchBalances(addr, assets),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toUpperCase();
  const filtered = assets.filter((a) => a.toUpperCase().includes(q));
  const sorted = [...filtered].sort(
    (a, b) => (balances?.[b] ?? 0) - (balances?.[a] ?? 0),
  );

  return (
    <div
      className="backdrop-fade fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="modal-pop w-full max-w-sm rounded-3xl bg-white p-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-sm font-semibold text-gray-900">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name"
          autoComplete="off"
          spellCheck={false}
          className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-purple-400 focus:bg-white"
          onKeyDown={(e) => {
            if (e.key === "Enter" && sorted.length === 1) {
              onSelect(sorted[0]);
              onClose();
            }
          }}
        />
        <div className="mt-2 max-h-[45vh] overflow-y-auto">
          {sorted.length === 0 ? (
            <p className="p-4 text-center text-sm text-gray-400">No matches</p>
          ) : (
            sorted.map((a) => {
              const bal = balances?.[a];
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    onSelect(a);
                    onClose();
                  }}
                  className={`flex h-14 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-gray-50 ${
                    a === selected ? "bg-purple-50/60" : ""
                  }`}
                >
                  <TokenImage
                    asset={a}
                    className="size-9 shrink-0 rounded-full bg-gray-100 object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
                    {rowLabel ? rowLabel(a) : a}
                  </span>
                  {bal !== undefined && bal > 0 && (
                    <span className="shrink-0 text-sm text-gray-500">
                      {commas(bal / SATS)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
