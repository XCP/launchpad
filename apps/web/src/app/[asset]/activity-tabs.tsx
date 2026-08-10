"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Fairmint } from "@/lib/api/counterparty";
import {
  commas,
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
import { useLaunchRoom } from "@/lib/launch-room";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { Identicon } from "./launch-view";
import { AddressHoverCard, useAddressFreshness } from "./scheduled-extras";

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

interface PendingMint {
  txHash: string;
  source: string;
  quantity: Raw;
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
  minting = false,
  issuerSource,
  blockHeight,
}: {
  asset: string;
  mints: Fairmint[];
  divisible: boolean;
  /** During the sale there is no market yet: no trades, no book. */
  minting?: boolean;
  /** Flags the launch creator's own row in the minters list. */
  issuerSource?: string;
  /** Needed only for the Minters tab, to judge address freshness. */
  blockHeight?: number;
}) {
  const { address } = useWallet();
  const compose = useCompose();
  const [tab, setTab] = useState<
    "minters" | "mempool" | "trades" | "holders" | "orders"
  >(minting ? "minters" : "trades");
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
        // Not `b.quantity - a.quantity`: legacy holdings can exceed 2^53.
        .sort((a, b) => compareRawDesc(a.quantity, b.quantity));
    },
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );
  // Exact sum: totals over all holders can exceed 2^53 (PEPECASH ~9.95e16).
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

  // Pending mints for this launch, from the page's shared room — the same
  // Durable Object LiveProgress's bar overlay reads, one poll loop server-side
  // per launch rather than a separate per-visitor mempool scan for every open
  // tab. No third-party fee lookups: those would mean one browser-side
  // request per pending mint to an external service, for every visitor who
  // opens this tab. That belongs server-side, which is exactly where the
  // room's own poll now lives.
  const { state: roomState } = useLaunchRoom();
  const pending: PendingMint[] = (roomState?.pending ?? []).map((p) => ({
    txHash: p.tx_hash,
    source: p.source,
    quantity: p.quantity,
  }));
  const pendingTotal = sumRaw(pending.map((p) => p.quantity));

  // One row per address: what they hold of this sale, what they paid, and
  // how many times they came back. Exact sums — a whale near the per-address
  // cap is the number this table exists to show.
  const minters = (() => {
    const byAddress = new Map<
      string,
      { source: string; earned: Raw[]; paid: Raw[]; mints: number }
    >();
    for (const m of mints) {
      const row = byAddress.get(m.source) ?? {
        source: m.source,
        earned: [],
        paid: [],
        mints: 0,
      };
      row.earned.push(m.earn_quantity);
      row.paid.push(m.paid_quantity);
      row.mints += 1;
      byAddress.set(m.source, row);
    }
    return [...byAddress.values()]
      .map((r) => ({
        source: r.source,
        earned: sumRaw(r.earned),
        paid: sumRaw(r.paid),
        mints: r.mints,
      }))
      .sort((a, b) => compareRawDesc(a.earned, b.earned));
  })();
  const mintersTotal = sumRaw(minters.map((r) => r.earned));
  const freshness = useAddressFreshness(
    minting ? minters.map((r) => r.source) : [],
    blockHeight ?? 0,
  );

  // During the sale there is no market and no separate holder set — the
  // minters ARE the holders — so "who is in" and "what's still queued"
  // are the only two live questions. Once there's a market, the mint
  // tape stops being the interesting question — what matters is what's
  // trading, what's resting on the book, and who's actually holding.
  const tabs: (typeof tab)[] = minting
    ? ["minters", "mempool"]
    : address
      ? ["trades", "orders", "holders"]
      : ["trades", "holders"];
  const tabLabel = (t: typeof tab) =>
    t === "minters"
      ? `Holders (${minters.length})`
      : t === "mempool"
        ? `Mempool${roomState ? ` (${pending.length})` : ""}`
        : t === "trades"
          ? `Trades${trades ? ` (${trades.length})` : ""}`
          : t === "holders"
            ? `Holders${holders ? ` (${holders.length})` : ""}`
            : `Orders${orders ? ` (${orders.length})` : ""}`;

  const count =
    tab === "minters"
      ? minters.length
      : tab === "mempool"
        ? pending.length
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
        className="rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
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
        className="rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      {/* A tab strip with one destination is chrome, not navigation — just
          say what the list below is. */}
      {tabs.length > 1 ? (
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
      ) : (
        <div className="border-b border-gray-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500">
          {tabLabel(tabs[0]!)}
        </div>
      )}

      {tab === "minters" &&
        (minters.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            No mints yet — be the first.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[2rem_minmax(0,1fr)_7rem_9rem_4.5rem] gap-x-4 px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <span />
              <span>Address</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Mints</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {minters.slice(from, from + PER_PAGE).map((r, i) => {
                const pct = ratio(r.earned, mintersTotal) * 100;
                return (
                  <li
                    key={r.source}
                    className="relative grid grid-cols-[2rem_minmax(0,1fr)_7rem_9rem_4.5rem] items-center gap-x-4 overflow-hidden px-4 py-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-purple-50/70"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    <span className="relative z-10 text-left text-xs text-gray-400 tabular-nums">
                      {from + i + 1}
                    </span>
                    <span className="relative z-10 flex min-w-0 items-center gap-2">
                      <AddressHoverCard
                        source={r.source}
                        className="flex min-w-0 items-center gap-2 font-mono text-gray-600 hover:text-purple-700"
                      >
                        <Identicon address={r.source} />
                        <span className="truncate">{shortAddress(r.source)}</span>
                      </AddressHoverCard>
                      {/* Outside the link: an ancestor's underline paints
                          through descendant text regardless of the
                          descendant's own text-decoration, so the only way
                          to keep the chip clean is to not be inside the <a>. */}
                      {issuerSource === r.source && (
                        <span className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-px text-[10px] font-medium text-purple-700">
                          dev
                        </span>
                      )}
                      {freshness?.newAddresses.has(r.source) && (
                        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                          no history
                        </span>
                      )}
                    </span>
                    <span className="relative z-10 text-right tabular-nums text-gray-900">
                      {commas(tokenQty(r.earned, divisible))}
                    </span>
                    <span className="relative z-10 text-right tabular-nums text-gray-500">
                      {commasRaw(r.paid)} XCP
                    </span>
                    <span className="relative z-10 text-right tabular-nums text-gray-500">
                      {r.mints} TX{r.mints === 1 ? "" : "s"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {pager}
          </>
        ))}

      {tab === "mempool" &&
        (!roomState ? (
          <p className="p-6 text-center text-sm text-gray-400">
            Loading mempool…
          </p>
        ) : pending.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            Nothing queued — every mint so far has confirmed.
          </p>
        ) : (
          <>
            <p className="border-b border-gray-100 bg-amber-50/50 px-4 py-2 text-xs text-amber-800">
              Unconfirmed and provisional — mempool mints can exceed what&apos;s
              left, get replaced, or never confirm. Only what lands on-chain
              counts.
            </p>
            <ul className="divide-y divide-gray-100">
              {pending.slice(from, from + PER_PAGE).map((p, i) => {
                const pct = ratio(p.quantity, pendingTotal) * 100;
                return (
                  <li
                    key={p.txHash}
                    className="relative flex items-center justify-between overflow-hidden px-4 py-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-amber-50"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    <a
                      href={`https://xcp.io/address/${p.source}`}
                      target="_blank"
                      rel="noreferrer"
                      className="relative z-10 flex min-w-0 items-center gap-2 font-mono text-gray-600 hover:text-purple-700 hover:underline"
                    >
                      <span className="w-8 shrink-0 text-right text-xs text-gray-400 tabular-nums">
                        {from + i + 1}
                      </span>
                      <Identicon address={p.source} />
                      <span className="truncate">{shortAddress(p.source)}</span>
                    </a>
                    <a
                      href={`https://xcp.io/tx/${p.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="relative z-10 shrink-0 text-right text-gray-900 hover:text-purple-700 hover:underline"
                    >
                      {compact(tokenQty(p.quantity, divisible))}{" "}
                      <span className="text-gray-400">pending</span>
                    </a>
                  </li>
                );
              })}
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
                      {/* No "no history" tag here — freshness at mint time
                          doesn't mean anything for a holder who bought in
                          on the market; only the issuer's own row is a
                          fact worth flagging post-graduation. */}
                      {issuerSource === h.address && (
                        <span className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-px text-[10px] font-medium text-purple-700">
                          dev
                        </span>
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
                      className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-red-400 hover:text-red-600 disabled:opacity-50"
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
