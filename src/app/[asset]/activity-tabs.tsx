"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Fairmint } from "@/lib/api/counterparty";
import {
  commasRaw,
  compact,
  price as formatPrice,
  shortAddress,
  tokenQty,
} from "@/lib/format";
import { big, compareRawDesc, type Raw, ratio, sumRaw } from "@/lib/numeric";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { isBusy } from "@/lib/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { Identicon } from "./launch-view";

const PER_PAGE = 25;

interface HolderRow {
  address: string;
  quantity: Raw;
}

interface TradeRow {
  key: string;
  block: number;
  buy: boolean;
  tokenRaw: Raw;
  xcpRaw: Raw;
  addr: string;
  via: "pool" | "book";
  txHash: string;
}

interface OpenOrder {
  tx_hash: string;
  give_asset: string;
  get_asset: string;
  give_quantity: Raw;
  get_quantity: Raw;
  give_remaining: Raw;
  expire_index: number | null;
}

/**
 * The activity card: Mints (the launch tape), Trades (pool + book fills,
 * merged), Holders (live top balances), and — when a wallet is connected —
 * Orders (your open orders on the pair, cancellable). Paginated locally;
 * addresses and transactions link out to the explorer.
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
  const { address } = useWallet();
  const compose = useCompose();
  const [tab, setTab] = useState<"mints" | "trades" | "holders" | "orders">(
    "mints",
  );
  const [pageParam, setPage] = useState(1);
  const setParams = (t: typeof tab, p: number) => {
    setTab(t);
    setPage(p);
  };

  const { data: holders } = useSWR<HolderRow[]>(
    tab === "holders"
      ? `${COUNTERPARTY_API_BASE}/assets/${asset}/balances?limit=1000`
      : null,
    async (url: string) => {
      const rows: { address: string | null; utxo: string | null; quantity: Raw }[] =
        (await fetchJson(url)).result ?? [];
      return rows
        .filter((r) => big(r.quantity) > 0n)
        .map((r) => ({
          address: r.address ?? (r.utxo ? `utxo:${r.utxo.slice(0, 12)}…` : "—"),
          quantity: r.quantity,
        }))
        // Not `b.quantity - a.quantity`: this list is arbitrary legacy assets,
        // where a holding can exceed 2^53, and subtracting two of those as
        // doubles returns zero for values that differ.
        .sort((a, b) => compareRawDesc(a.quantity, b.quantity));
    },
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );
  // Every percentage in the tab is a fraction of this, and it is a sum over
  // every holder of the asset — PEPECASH's would be 9.95e16, an order of
  // magnitude past what a `+` accumulator can carry.
  const holderTotal = sumRaw(holders?.map((h) => h.quantity) ?? []);

  // Trades: pool fills + completed book fills, one tape, newest first.
  const { data: trades } = useSWR<TradeRow[]>(
    tab === "trades" ? [asset, "pair-trades"] : null,
    async () => {
      const [pm, om] = await Promise.all([
        fetchJson(
          `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/matches?limit=250`,
        ).catch(() => ({ result: [] })),
        fetchJson(
          `${COUNTERPARTY_API_BASE}/orders/${asset}/XCP/matches?status=completed&limit=250`,
        ).catch(() => ({ result: [] })),
      ]);
      const poolRows: TradeRow[] = (pm.result ?? []).map(
        (r: {
          tx_hash: string;
          block_index: number;
          source: string;
          forward_asset: string;
          forward_quantity: Raw;
          backward_quantity: Raw;
        }) => ({
          key: `p-${r.tx_hash}`,
          block: r.block_index,
          buy: r.forward_asset === asset,
          tokenRaw:
            r.forward_asset === asset ? r.forward_quantity : r.backward_quantity,
          xcpRaw:
            r.forward_asset === asset ? r.backward_quantity : r.forward_quantity,
          addr: r.source,
          via: "pool" as const,
          txHash: r.tx_hash,
        }),
      );
      const bookRows: TradeRow[] = (om.result ?? []).map(
        (r: {
          id: string;
          tx1_hash: string;
          tx1_address: string;
          block_index: number;
          forward_asset: string;
          forward_quantity: Raw;
          backward_quantity: Raw;
        }) => ({
          key: `o-${r.id}`,
          block: r.block_index,
          buy: r.forward_asset === asset,
          tokenRaw:
            r.forward_asset === asset ? r.forward_quantity : r.backward_quantity,
          xcpRaw:
            r.forward_asset === asset ? r.backward_quantity : r.forward_quantity,
          addr: r.tx1_address,
          via: "book" as const,
          txHash: r.tx1_hash,
        }),
      );
      return [...poolRows, ...bookRows].sort((a, b) => b.block - a.block);
    },
    { refreshInterval: 30_000 },
  );

  // Your open orders on this pair (connected only).
  const { data: orders, mutate: refreshOrders } = useSWR<OpenOrder[]>(
    tab === "orders" && address
      ? `${COUNTERPARTY_API_BASE}/addresses/${address}/orders?status=open&limit=100`
      : null,
    async (url: string) =>
      ((await fetchJson(url)).result as OpenOrder[]).filter(
        (o) =>
          (o.give_asset === asset && o.get_asset === "XCP") ||
          (o.give_asset === "XCP" && o.get_asset === asset),
      ),
    { refreshInterval: 15_000 },
  );
  const busy = isBusy(compose.status);

  const tabs: (typeof tab)[] = address
    ? ["mints", "trades", "holders", "orders"]
    : ["mints", "trades", "holders"];
  const tabLabel = (t: typeof tab) =>
    t === "mints"
      ? `Mints (${mints.length})`
      : t === "trades"
        ? `Trades${trades ? ` (${trades.length})` : ""}`
        : t === "holders"
          ? `Holders${holders ? ` (${holders.length})` : ""}`
          : `Orders${orders ? ` (${orders.length})` : ""}`;

  const count =
    tab === "mints"
      ? mints.length
      : tab === "trades"
        ? (trades?.length ?? 0)
        : tab === "holders"
          ? (holders?.length ?? 0)
          : (orders?.length ?? 0);
  const totalPages = Math.max(1, Math.ceil(count / PER_PAGE));
  const page = Math.min(pageParam, totalPages);
  const from = (page - 1) * PER_PAGE;

  const pager = totalPages > 1 && (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => setParams(tab, page - 1)}
        className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
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
        className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <Tabs value={tab} onValueChange={(v) => setParams(v as typeof tab, 1)}>
        <div className="border-b border-gray-200 p-2">
          <SegmentedList variant="card">
            {tabs.map((t) => (
              <SegmentedTrigger key={t} value={t} variant="card" grow={false}>
                {tabLabel(t)}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </div>
      </Tabs>

      {tab === "mints" &&
        (mints.length === 0 ? (
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
                      ({commasRaw(m.paid_quantity)} XCP)
                    </span>
                  </span>
                  <a
                    href={`https://xcp.io/tx/${m.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-500 hover:text-purple-700 hover:underline"
                  >
                    block {m.block_index}
                  </a>
                </li>
              ))}
            </ul>
            {pager}
          </>
        ))}

      {tab === "trades" &&
        (!trades ? (
          <p className="p-6 text-center text-sm text-gray-400">Loading trades…</p>
        ) : trades.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No trades yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {trades.slice(from, from + PER_PAGE).map((t) => {
                const tokens = tokenQty(t.tokenRaw, divisible);
                return (
                  <li
                    key={t.key}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`font-medium ${t.buy ? "text-green-700" : "text-red-600"}`}
                      >
                        {t.buy ? "↗ Buy" : "↘ Sell"}
                      </span>
                      <span className="text-gray-900">{compact(tokens)}</span>
                      <a
                        href={`https://xcp.io/address/${t.addr}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hidden min-w-0 items-center gap-1.5 truncate font-mono text-xs text-gray-500 hover:text-purple-700 hover:underline sm:flex"
                      >
                        <Identicon address={t.addr} />
                        {shortAddress(t.addr)}
                      </a>
                    </span>
                    <span className="text-right text-gray-900">
                      {commasRaw(t.xcpRaw)} XCP{" "}
                      <span className="text-gray-400">
                        (
                        {formatPrice(
                          ratio(t.xcpRaw, t.tokenRaw) / (divisible ? 1 : 1e8),
                        )}{" "}
                        ea · {t.via})
                      </span>
                    </span>
                    <a
                      href={`https://xcp.io/tx/${t.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden text-xs text-gray-500 hover:text-purple-700 hover:underline md:block"
                    >
                      block {t.block}
                    </a>
                  </li>
                );
              })}
            </ul>
            {pager}
          </>
        ))}

      {tab === "holders" &&
        (!holders ? (
          <p className="p-6 text-center text-sm text-gray-400">Loading holders…</p>
        ) : holders.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No holders found.</p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {holders.slice(from, from + PER_PAGE).map((h, i) => {
                const pct = ratio(h.quantity, holderTotal) * 100;
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
        ))}

      {tab === "orders" &&
        (!address ? (
          <p className="p-6 text-center text-sm text-gray-500">
            Connect your wallet to see your open orders.
          </p>
        ) : !orders ? (
          <p className="p-6 text-center text-sm text-gray-400">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            No open orders on this pair.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {orders.map((o) => {
                const isBuy = o.get_asset === asset;
                const tokens = isBuy ? o.get_quantity : o.give_quantity;
                const xcp = isBuy ? o.give_quantity : o.get_quantity;
                const filled = 1 - ratio(o.give_remaining, o.give_quantity);
                return (
                  <li
                    key={o.tx_hash}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span
                        className={
                          isBuy
                            ? "font-medium text-green-700"
                            : "font-medium text-red-600"
                        }
                      >
                        {isBuy ? "Buy" : "Sell"}
                      </span>{" "}
                      {commasRaw(tokens)} @ {formatPrice(ratio(xcp, tokens))}
                      <span className="ml-2 text-xs text-gray-500">
                        {(filled * 100).toFixed(0)}% filled ·{" "}
                        {o.expire_index === null
                          ? "GTC"
                          : `expires block ${o.expire_index.toLocaleString()}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        compose.composeCancel({ offer_hash: o.tx_hash })
                      }
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-red-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {busy ? "…" : "Cancel"}
                    </button>
                  </li>
                );
              })}
            </ul>
            {compose.status === "confirmed" && (
              <p className="border-t border-gray-100 px-4 py-2 text-xs text-green-700">
                Cancel broadcast — the remainder refunds when it confirms.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    compose.reset();
                    refreshOrders();
                  }}
                >
                  Dismiss
                </button>
              </p>
            )}
            {compose.status === "error" && (
              <p className="border-t border-gray-100 px-4 py-2 text-xs text-red-600">
                {compose.error}
              </p>
            )}
          </>
        ))}
    </div>
  );
}
