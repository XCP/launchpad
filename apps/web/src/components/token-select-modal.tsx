"use client";

import { useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { Dialog } from "@/components/ui/dialog";
import { fetchBalance } from "@/lib/client";
import { commasRaw } from "@/lib/format";

async function fetchBalances(
  address: string,
  assets: string[],
): Promise<Record<string, bigint>> {
  const entries = await Promise.all(
    assets.map(async (a) => {
      try {
        return [a, await fetchBalance(address, a)] as const;
      } catch {
        return [a, 0n] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * The token selector every swap UI ships: a modal (never a dropdown) with
 * search, 56px rows, and balances right-aligned. Row order is supplied by
 * the market list and never changes underneath an open pointer.
 * Radix Dialog supplies focus trap, Escape, and scroll lock; content
 * unmounts on close so the search resets.
 */
export function TokenSelectModal({
  open,
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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <ModalBody
        assets={assets}
        selected={selected}
        address={address}
        rowLabel={rowLabel}
        onPick={(a) => {
          onSelect(a);
          onClose();
        }}
      />
    </Dialog>
  );
}

function ModalBody({
  assets,
  selected,
  address,
  rowLabel,
  onPick,
}: {
  assets: string[];
  selected?: string;
  address?: string | null;
  rowLabel?: (asset: string) => string;
  onPick: (asset: string) => void;
}) {
  const [query, setQuery] = useState("");

  const { data: balances } = useSWR(
    address ? [address, assets.join(","), "modal-balances"] : null,
    ([addr]) => fetchBalances(addr, assets),
  );

  const q = query.trim().toUpperCase();
  // Stable on purpose. Balances arrive after the modal opens; using them as a
  // sort key made every row jump just as someone was about to select it.
  const shown = assets.filter((a) => a.toUpperCase().includes(q));

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name"
        autoComplete="off"
        spellCheck={false}
        className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-purple-400 focus:bg-white"
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown.length === 1) onPick(shown[0]);
        }}
      />
      <div className="mt-2 max-h-[45vh] overflow-y-auto">
        {shown.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-400">No matches</p>
        ) : (
          shown.map((a) => {
            const bal = balances?.[a];
            return (
              <button
                key={a}
                type="button"
                onClick={() => onPick(a)}
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
                {bal !== undefined && bal > 0n && (
                  <span className="shrink-0 text-sm text-gray-500">
                    {commasRaw(bal)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
