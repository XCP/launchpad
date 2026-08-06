"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { Fairmint } from "@/lib/api/counterparty";
import { commas, compact, fromSats, shortAddress, tokenQty } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { Identicon } from "./launch-view";

const PER_PAGE = 25;

interface HolderRow {
  address: string;
  quantity: number;
}

/**
 * The activity card: Mints (the launch tape) and Holders (live top
 * balances) as tabs, paginated and deep-linkable — ?tab=holders&p=3
 * restores exactly this view. Addresses and transactions link out to the
 * explorer.
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
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = sp.get("tab") === "holders" ? "holders" : "mints";
  const pageParam = Math.max(1, parseInt(sp.get("p") ?? "1", 10) || 1);

  const setParams = (t: "mints" | "holders", p: number) => {
    const q = new URLSearchParams(sp.toString());
    if (t === "mints") q.delete("tab");
    else q.set("tab", t);
    if (p <= 1) q.delete("p");
    else q.set("p", String(p));
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const { data: holders } = useSWR<HolderRow[]>(
    tab === "holders"
      ? `${COUNTERPARTY_API_BASE}/assets/${asset}/balances?limit=1000`
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

  const count = tab === "mints" ? mints.length : (holders?.length ?? 0);
  const totalPages = Math.max(1, Math.ceil(count / PER_PAGE));
  const page = Math.min(pageParam, totalPages);
  const from = (page - 1) * PER_PAGE;

  const pager = totalPages > 1 && (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => setParams(tab, page - 1)}
        className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Prev
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => setParams(tab, page + 1)}
        className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-1 border-b border-gray-200 p-2">
        {(["mints", "holders"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setParams(t, 1)}
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
          <>
            <ul className="divide-y divide-gray-100">
              {mints.slice(from, from + PER_PAGE).map((m) => (
                <li
                  key={m.tx_hash}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <a
                    href={`https://xcp.io/address/${m.source}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 font-mono text-gray-600 hover:text-purple-700 hover:underline"
                  >
                    <Identicon address={m.source} />
                    {shortAddress(m.source)}
                  </a>
                  <span className="text-gray-900">
                    {compact(tokenQty(m.earn_quantity, divisible))}{" "}
                    <span className="text-gray-400">
                      ({commas(fromSats(m.paid_quantity))} XCP)
                    </span>
                  </span>
                  <a
                    href={`https://xcp.io/tx/${m.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 hover:text-purple-700 hover:underline"
                  >
                    block {m.block_index}
                  </a>
                </li>
              ))}
            </ul>
            {pager}
          </>
        )
      ) : !holders ? (
        <p className="p-6 text-center text-sm text-gray-400">Loading holders…</p>
      ) : holders.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">No holders found.</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {holders.slice(from, from + PER_PAGE).map((h, i) => {
              const pct = holderTotal > 0 ? (h.quantity / holderTotal) * 100 : 0;
              const isUtxo = h.address.startsWith("utxo:");
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
                    <span className="w-8 text-right text-xs text-gray-400">
                      {from + i + 1}
                    </span>
                    <Identicon address={h.address} />
                    {isUtxo ? (
                      h.address
                    ) : (
                      <a
                        href={`https://xcp.io/address/${h.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-purple-700 hover:underline"
                      >
                        {shortAddress(h.address)}
                      </a>
                    )}
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
          {pager}
        </>
      )}
    </div>
  );
}
