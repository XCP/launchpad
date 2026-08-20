"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import type { Fairmint } from "@/lib/api/counterparty";
import {
  commas,
  commasRaw,
  compact,
  fixedRaw,
  price as formatPrice,
  shortAddress,
  tokenQty,
} from "@/lib/format";
import { big, compareRawDesc, type Raw, ratio, sumRaw } from "@/lib/numeric";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchJson } from "@/lib/client";
import { useLaunchRoom } from "@/app/[asset]/_components/launch-room";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { Identicon } from "@/app/[asset]/_components/launch-view";
import { useAddressFreshness } from "@/app/[asset]/_components/launch-stats";
import { AddressHoverCard } from "@/components/address-hover-card";
import { useMempool } from "@/hooks/use-mempool";
import { mergePairTrades } from "@launchpad/xcp69/trades";

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
  poolTokensRaw,
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
  /** Token side of the locked pool. Counterparty holds pool reserves in the
   *  pool itself, not at an address, so it never appears in /balances — which
   *  quietly makes the holder list look like it covers the whole supply when
   *  roughly a third of it is locked away. Passed in so it can be shown in
   *  the ranking where it belongs. */
  poolTokensRaw?: Raw;
}) {
  const { address } = useWallet();
  const { orders: mempoolOrders } = useMempool(30_000);
  const compose = useCompose();
  const [tab, setTab] = useState<
    "minters" | "mempool" | "trades" | "holders" | "orders"
  >(minting ? "minters" : "trades");
  const [pageParam, setPage] = useState(1);
  const setParams = (t: typeof tab, p: number) => {
    setTab(t);
    setPage(p);
  };

  // One subscription for the whole card: the mempool tape, the trade tape,
  // and the status the page watches for a transition all arrive on it.
  const { state: roomState } = useLaunchRoom();

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
  /** Synthesised, not fetched — the pool has no address to report a balance
   *  for. Marked unmistakably in the row itself, because a fabricated entry in
   *  a list of on-chain facts has to announce that it is one. */
  const POOL_ROW = "__pool__";
  const holderRows: HolderRow[] =
    poolTokensRaw && big(poolTokensRaw) > 0n
      ? [...(holders ?? []), { address: POOL_ROW, quantity: poolTokensRaw }].sort((a, b) =>
          compareRawDesc(a.quantity, b.quantity),
        )
      : (holders ?? []);
  // Shares are of circulating PLUS the locked pool, which is what makes them
  // read as shares of supply rather than of whatever is left over.
  const holderTotal = sumRaw(holderRows.map((h) => h.quantity));

  // Trades come over the room's shared socket when it's connected — one poll
  // per launch instead of one per viewer, and new fills simply appear. This
  // fetch is the fallback for a socket that never connected.
  const roomTrades: TradeRow[] | null =
    roomState?.trades?.map((t) => ({
      key: t.key,
      block: t.block,
      buy: t.buy,
      tokenRaw: t.token_quantity,
      xcpRaw: t.xcp_quantity,
      addr: t.address,
      via: t.venue,
      txHash: t.tx_hash,
    })) ?? null;

  const { data: fetchedTrades } = useSWR<TradeRow[]>(
    tab === "trades" && roomTrades === null ? [asset, "pair-trades"] : null,
    async () => {
      const [pm, om] = await Promise.all([
        fetchJson(
          `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/matches?verbose=true&limit=250`,
        ).catch(() => ({ result: [] })),
        fetchJson(
          `${COUNTERPARTY_API_BASE}/orders/${asset}/XCP/matches?verbose=true&status=completed&limit=250`,
        ).catch(() => ({ result: [] })),
      ]);
      const merged = await mergePairTrades(
        asset,
        pm.result ?? [],
        om.result ?? [],
        async (txHash) =>
          (
            await fetchJson(
              `${COUNTERPARTY_API_BASE}/transactions/${txHash}/events?limit=1000`,
            )
          ).result ?? [],
      );
      return merged.map((trade) => ({
        key: trade.key,
        block: trade.block,
        buy: trade.buy,
        tokenRaw: trade.tokenQuantity,
        xcpRaw: trade.xcpQuantity,
        addr: trade.address,
        via: trade.venue,
        txHash: trade.txHash,
      }));
    },
    { refreshInterval: 30_000 },
  );
  const trades = roomTrades ?? fetchedTrades;

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
  const pending: PendingMint[] = (roomState?.pending ?? []).map((p) => ({
    txHash: p.tx_hash,
    source: p.source,
    quantity: p.quantity,
  }));
  const pendingTotal = sumRaw(pending.map((p) => p.quantity));
  const pendingOrders = mempoolOrders.filter((o) => o.asset === asset);

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
      ? ["trades", "orders", "holders", "mempool"]
      : ["trades", "holders", "mempool"];
  const tabLabel = (t: typeof tab) =>
    t === "minters"
      ? `Holders (${minters.length})`
      : t === "mempool"
        ? `Mempool${minting ? (roomState ? ` (${pending.length})` : "") : pendingOrders.length > 0 ? ` (${pendingOrders.length})` : ""}`
        : t === "trades"
          ? `Trades${trades ? ` (${trades.length})` : ""}`
          : t === "holders"
            ? `Holders${holders ? ` (${holders.length})` : ""}`
            : `Orders${orders ? ` (${orders.length})` : ""}`;

  const count =
    tab === "minters"
      ? minters.length
      : tab === "mempool"
        ? minting
          ? pending.length
          : pendingOrders.length
        : tab === "trades"
          ? (trades?.length ?? 0)
          : tab === "holders"
            ? holderRows.length
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
            {/* The address column has a 16.5rem FLOOR, not a shrinkable 1fr:
                shortAddress() is already the shortest honest form, so when
                the "dev" and "no history" chips both land on one row the row
                gets wider — never the address shorter. The floor is sized to
                identicon + 13-char address + both chips; with it, the row's
                minimum is 41.5rem (2 + 16.5 + 6 + 6.5 + 4.5 tracks, 4rem of
                gaps, 2rem padding — keep the wrapper's min-w in step), which
                still fits the max-w-2xl card on desktop. Anything narrower
                scrolls here — inside a bounded wrapper — so every row's own
                overflow-hidden (used for the progress-bar fill) clips only
                the fill, not the columns themselves. */}
            <div className="overflow-x-auto">
              <div className="min-w-[41.5rem]">
                <div className="grid grid-cols-[2rem_minmax(16.5rem,1fr)_6rem_6.5rem_4.5rem] gap-x-4 px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">
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
                        className="relative grid grid-cols-[2rem_minmax(16.5rem,1fr)_6rem_6.5rem_4.5rem] items-center gap-x-4 overflow-hidden px-4 py-2 text-sm"
                      >
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 bg-purple-50/70"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                        <span className="relative z-10 text-left text-xs text-gray-400 tabular-nums">
                          {from + i + 1}
                        </span>
                        <span className="relative z-10 flex items-center gap-2">
                          <AddressHoverCard
                            source={r.source}
                            className="flex items-center gap-2 font-mono text-gray-600 hover:text-purple-700"
                          >
                            <Identicon address={r.source} />
                            <span className="whitespace-nowrap">{shortAddress(r.source)}</span>
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
              </div>
            </div>
            {pager}
          </>
        ))}

      {tab === "mempool" && minting &&
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
                    <Link
                      href={`/profile/${p.source}`}
                      className="relative z-10 flex min-w-0 items-center gap-2 font-mono text-gray-600 hover:text-purple-700 hover:underline"
                    >
                      <span className="w-8 shrink-0 text-right text-xs text-gray-400 tabular-nums">
                        {from + i + 1}
                      </span>
                      <Identicon address={p.source} />
                      <span className="truncate">{shortAddress(p.source)}</span>
                    </Link>
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

      {tab === "mempool" && !minting &&
        (pendingOrders.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            No orders for {asset} are waiting in the mempool.
          </p>
        ) : (
          <>
            <p className="border-b border-gray-100 bg-amber-50/50 px-4 py-2 text-xs text-amber-800">
              Unconfirmed and provisional — these orders join the book only after confirmation.
            </p>
            <ul className="divide-y divide-gray-100">
              {pendingOrders.slice(from, from + PER_PAGE).map((o, i) => {
                const buy = o.getAsset === asset;
                return (
                  <li key={o.txHash} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <Link href={`/profile/${o.source}`} className="flex min-w-0 items-center gap-2 font-mono text-gray-600 hover:text-purple-700 hover:underline">
                      <span className="w-8 shrink-0 text-right text-xs text-gray-400 tabular-nums">{from + i + 1}</span>
                      <Identicon address={o.source} />
                      <span className="truncate">{shortAddress(o.source)}</span>
                    </Link>
                    <a href={`https://xcp.io/tx/${o.txHash}`} target="_blank" rel="noreferrer" className={`shrink-0 font-medium hover:underline ${buy ? "text-green-700" : "text-red-600"}`}>
                      {buy ? "Buy" : "Sell"} pending
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[43rem] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">XCP</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-4 py-2 text-right">Venue / block</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trades.slice(from, from + PER_PAGE).map((t) => {
                    const tokens = tokenQty(t.tokenRaw, divisible);
                    return (
                      <tr key={t.key}>
                        <td className={`whitespace-nowrap px-4 py-2 font-medium ${t.buy ? "text-green-700" : "text-red-600"}`}>
                          {t.buy ? "↗ Buy" : "↘ Sell"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-500">
                          {formatPrice(ratio(t.xcpRaw, t.tokenRaw) / (divisible ? 1 : 1e8))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                          {compact(tokens)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                          {fixedRaw(t.xcpRaw)}
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/profile/${t.addr}`} className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-gray-500 hover:text-purple-700 hover:underline">
                            <Identicon address={t.addr} />
                            {shortAddress(t.addr)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-gray-500">
                          <a href={`https://xcp.io/tx/${t.txHash}`} target="_blank" rel="noreferrer" className="hover:text-purple-700 hover:underline">
                            {t.via} · {commas(t.block)}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
            {/* Scrolls sideways on a phone rather than compressing. The row
                is address + chips + amount, and at 390px those don't fit —
                but every one of them is load-bearing: the chips say WHO a
                holder is ("dev", "LP burned") and the address says which
                one. Squeezing let the chips ride over the address and cover
                it entirely, which is the worst of both. Given a floor width
                the row keeps its shape and the reader moves instead. */}
            <div className="overflow-x-auto">
            <ul className="min-w-[30rem] divide-y divide-gray-100">
              {holderRows.slice(from, from + PER_PAGE).map((h, i) => {
                const pct = ratio(h.quantity, holderTotal) * 100;
                const isPool = h.address === POOL_ROW;
                const isUtxo = h.address.startsWith("utxo:");
                return (
                  <li
                    key={h.address}
                    className="relative flex items-center justify-between gap-3 overflow-hidden px-4 py-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-purple-50/70"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    <span className="relative z-10 flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-gray-600">
                      <span className="w-8 text-right text-xs text-gray-400">
                        {from + i + 1}
                      </span>
                      {isPool ? (
                        <>
                          <span aria-hidden className="text-sm">🔒</span>
                          <span className="font-sans font-medium text-gray-900">
                            Locked pool
                          </span>
                          <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-1.5 py-px text-[10px] font-medium text-green-700">
                            LP burned
                          </span>
                        </>
                      ) : (
                        <>
                          <Identicon address={h.address} />
                          {isUtxo ? (
                            h.address
                          ) : (
                            <Link
                              href={`/profile/${h.address}`}
                              className="hover:text-purple-700 hover:underline"
                            >
                              {shortAddress(h.address)}
                            </Link>
                          )}
                        </>
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
                    <span className="relative z-10 ml-auto shrink-0 whitespace-nowrap text-gray-900">
                      {compact(tokenQty(h.quantity, divisible))}{" "}
                      <span className="text-gray-400">
                        ({pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%)
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            </div>
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
