"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Fairmint } from "@/lib/api/counterparty";
import { commas, compact, fromSats, shortAddress, tokenQty } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { Identicon } from "./launch-view";

interface HolderRow {
  address: string;
  quantity: number;
}

/**
 * The activity card: Mints (the launch tape) and Holders (live top
 * balances) as tabs. Holders load on first open — top 200 by balance,
 * with share-of-supply computed against the sum actually returned.
 */
export function ActivityTabs({
  asset,
  mints,
  divisible,
}: {
  asset: string;
  mints: Fairmint[];
  divisible: boolean;
}) {
  const [tab, setTab] = useState<"mints" | "holders">("mints");

  const { data: holders } = useSWR<HolderRow[]>(
    tab === "holders"
      ? `${COUNTERPARTY_API_BASE}/assets/${asset}/balances?limit=200`
      : null,
    async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: { address: string | null; utxo: string | null; quantity: number }[] =
        (await res.json()).result ?? [];
      return rows
        .filter((r) => r.quantity > 0)
        .map((r) => ({
          address: r.address ?? (r.utxo ? `utxo:${r.utxo.slice(0, 12)}…` : "—"),
          quantity: r.quantity,
        }))
        .sort((a, b) => b.quantity - a.quantity);
    },
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );
  const holderTotal = holders?.reduce((s, h) => s + h.quantity, 0) ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-1 border-b border-gray-200 p-2">
        {(["mints", "holders"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
              tab === t
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "mints"
              ? `Mints (${mints.length})`
              : `Holders${holders ? ` (${holders.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "mints" ? (
        mints.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No mints yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {mints.slice(0, 100).map((m) => (
              <li
                key={m.tx_hash}
                className="flex items-center justify-between px-4 py-2 text-sm"
              >
                <span className="flex items-center gap-2 font-mono text-gray-600">
                  <Identicon address={m.source} />
                  {shortAddress(m.source)}
                </span>
                <span className="text-gray-900">
                  {compact(tokenQty(m.earn_quantity, divisible))}{" "}
                  <span className="text-gray-400">
                    ({commas(fromSats(m.paid_quantity))} XCP)
                  </span>
                </span>
                <span className="text-xs text-gray-400">block {m.block_index}</span>
              </li>
            ))}
          </ul>
        )
      ) : !holders ? (
        <p className="p-6 text-center text-sm text-gray-400">Loading holders…</p>
      ) : holders.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">No holders found.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {holders.slice(0, 100).map((h, i) => {
            const pct = holderTotal > 0 ? (h.quantity / holderTotal) * 100 : 0;
            return (
              <li
                key={h.address}
                className="relative flex items-center justify-between overflow-hidden px-4 py-2 text-sm"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-purple-50/70"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
                <span className="relative z-10 flex items-center gap-2 font-mono text-gray-600">
                  <span className="w-6 text-right text-xs text-gray-400">
                    {i + 1}
                  </span>
                  <Identicon address={h.address} />
                  {h.address.startsWith("utxo:")
                    ? h.address
                    : shortAddress(h.address)}
                </span>
                <span className="relative z-10 text-gray-900">
                  {compact(tokenQty(h.quantity, divisible))}{" "}
                  <span className="text-gray-400">
                    ({pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%)
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
