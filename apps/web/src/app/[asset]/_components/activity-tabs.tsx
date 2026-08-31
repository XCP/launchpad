"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import useSWR from "swr";
import {
  fetchHolderBalances,
  fetchLpBalances,
  type Fairmint,
} from "@/lib/api/counterparty";
import { BURN_ADDRESS } from "@/lib/inscriber/constants";
import {
  commas,
  commasRaw,
  compact,
  fixedRaw,
  shortAddress,
  tokenQty,
} from "@/lib/format";
import { big, compareRawDesc, type Raw, ratio, sumRaw } from "@/lib/numeric";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchJson } from "@/lib/client";
import { timeAgo } from "@/lib/chain-time";
import { useLaunchRoom } from "@/app/[asset]/_components/launch-room";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { Identicon } from "@/app/[asset]/_components/launch-view";
import { useAddressFreshness } from "@/app/[asset]/_components/launch-stats";
import {
  AddressHoverCard,
  LaunchpadAddressHoverCard,
} from "@/components/address-hover-card";
import { useMempool } from "@/hooks/use-mempool";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { mergePairTrades } from "@launchpad/xcp69/trades";
import {
  currentHolderCount,
  includeFormerHolders,
  poolLockStatus,
  type HolderRow,
  type LpBalance,
} from "@/lib/holders";

const PER_PAGE = 25;

/**
 * Column layout shared by the Trades and Orders tables, which render the same
 * six columns. The 41.5rem floor matches the minters grid above and stays
 * under the card's 42rem width, so the table scrolls only on viewports
 * narrower than the card itself.
 */
const PAIR_TABLE = "w-full min-w-[41.5rem] text-sm";

interface TradeRow {
  key: string;
  block: number;
  time: number;
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
  source: string;
  give_asset: string;
  get_asset: string;
  give_quantity: Raw;
  get_quantity: Raw;
  give_remaining: Raw;
  get_remaining: Raw;
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
  poolXcpRaw,
  poolTokensRaw,
  lpAsset,
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
  /** XCP side of the pool, reused by the trader hover's reconciled PnL. */
  poolXcpRaw?: Raw;
  /** Token side of the locked pool. Counterparty holds pool reserves in the
   *  pool itself, not at an address, so it never appears in /balances — which
   *  quietly makes the holder list look like it covers the whole supply when
   *  roughly a third of it is locked away. Passed in so it can be shown in
   *  the ranking where it belongs. */
  poolTokensRaw?: Raw;
  /** The pool's LP token. Its holders decide whether the pool row may call
   *  itself locked — see splitPoolByLock. */
  lpAsset?: string | null;
}) {
  const { address } = useWallet();
  const { orders: mempoolOrders } = useMempool(30_000);
  const compose = useCompose();
  const [tab, setTab] = useState<
    "minters" | "mempool" | "trades" | "holders" | "orders"
  >(minting ? "minters" : "trades");
  const [pageParam, setPage] = useState(1);
  const [, setTimeTick] = useState(0);
  const setParams = (t: typeof tab, p: number) => {
    setTab(t);
    setPage(p);
  };

  // The tape re-renders only when the trade data itself changes, so the
  // relative ages need their own timer. The interval matches the minute
  // resolution of the label.
  const showsAges = tab === "trades";
  useEffect(() => {
    if (!showsAges) return;
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [showsAges]);

  // Coarse pointers cannot hover, so the trade tape renders the block height
  // inline instead of only in the title attribute.
  const coarse = useCoarsePointer();

  // One subscription for the whole card: the mempool tape, the trade tape,
  // and the status the page watches for a transition all arrive on it.
  const { state: roomState } = useLaunchRoom();

  const { data: holders } = useSWR<HolderRow[]>(
    !minting ? [asset, "holder-balances"] : null,
    () => fetchHolderBalances(asset),
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );
  const liveHolderCount = holders ? currentHolderCount(holders, [BURN_ADDRESS]) : null;

  // Who holds the LP decides whether the pool's tokens are actually locked.
  // Slow-moving — liquidity events are rare — so this polls far less often
  // than balances do.
  const { data: lpBalances } = useSWR<LpBalance[]>(
    !minting && lpAsset ? [lpAsset, "lp-balances"] : null,
    () => fetchLpBalances(lpAsset!),
    { revalidateOnFocus: false, refreshInterval: 300_000 },
  );
  // Trades come over the room's shared socket when it's connected — one poll
  // per launch instead of one per viewer, and new fills simply appear. This
  // fetch is the fallback for a socket that never connected.
  const roomTrades: TradeRow[] | null =
    roomState?.trades?.map((t) => ({
      key: t.key,
      block: t.block,
      time: t.time,
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
        time: trade.time,
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

  /** Synthesised, not fetched — the pool has no address to report a balance
   *  for. Marked unmistakably in the row itself, because a fabricated entry in
   *  a list of on-chain facts has to announce that it is one. */
  const POOL_ROW = "__pool__";
  // Counterparty's balance endpoint is a live snapshot, not holder history.
  // Restore absent minters/traders at zero so the table can show who sold out,
  // while the tab/header/card counts above remain strictly current balances.
  const holderHistory = includeFormerHolders(
    holders ?? [],
    [
      ...mints.map((mint) => mint.source),
      ...(trades ?? []).map((trade) => trade.addr),
    ],
  );
  // One row: the pool is a single concentration of supply, and how much of it
  // is locked is a property OF that row, not a second holder.
  const poolLock = poolLockStatus(
    big(poolTokensRaw ?? 0),
    lpBalances ?? [],
    [BURN_ADDRESS],
  );
  const holderRows: HolderRow[] =
    poolTokensRaw && big(poolTokensRaw) > 0n
      ? [
          ...holderHistory,
          { address: POOL_ROW, quantity: big(poolTokensRaw) },
        ].sort((a, b) => compareRawDesc(a.quantity, b.quantity))
      : holderHistory;
  const holderBalance = new Map(
    holderRows
      .filter((row) => row.address !== POOL_ROW)
      .map((row) => [row.address, row.quantity]),
  );
  // Shares are of circulating PLUS the locked pool, which is what makes them
  // read as shares of supply rather than of whatever is left over.
  const holderTotal = sumRaw(holderRows.map((h) => h.quantity));

  /**
   * The PAIR'S open order book -- everyone's, not just yours.
   *
   * This used to fetch /addresses/<you>/orders, so the tab showed your own
   * orders and its empty state read "No open orders on this pair" while the
   * pair had eleven live orders on the book. A sentence about the reader,
   * rendered as a statement about the market, on the page about that market.
   *
   * Your own orders now live on /profile, where a personal holding belongs.
   * They are still marked and cancellable here, because the row you can act on
   * is worth finding in the depth around it.
   */
  const { data: orders, mutate: refreshOrders } = useSWR<OpenOrder[]>(
    !minting
      ? `${COUNTERPARTY_API_BASE}/orders/${encodeURIComponent(asset)}/XCP?status=open&verbose=true&limit=200`
      : null,
    async (url: string) => (await fetchJson(url)).result as OpenOrder[],
    { refreshInterval: 15_000 },
  );
  // Remaining quantities, not original ones: a half-filled order offers what is
  // left of it, and drawing the original overstates the depth actually there.
  const book = (orders ?? []).map((o) => {
    const isBuy = o.get_asset === asset;
    const tokens = isBuy ? o.get_remaining : o.give_remaining;
    const xcp = isBuy ? o.give_remaining : o.get_remaining;
    return {
      o,
      isBuy,
      price: ratio(xcp, tokens),
      amountText: compact(tokenQty(tokens, divisible)),
      xcpText: fixedRaw(xcp),
    };
  });
  const bids = book.filter((r) => r.isBuy).sort((a, b) => b.price - a.price);
  const asks = book.filter((r) => !r.isBuy).sort((a, b) => a.price - b.price);
  /**
   * The pool, quoted as the two prices it actually offers.
   *
   * A constant-product pool is not one price. It is a bid and an ask, and the
   * gap between them is the fee: you buy at spot/(1-f) and sell at spot*(1-f),
   * which for a 0.5% fee is a built-in 1.008% spread before size is considered
   * at all. Showing the midpoint — as every "pool price" on this site does —
   * quotes a number nobody can actually trade at, in either direction.
   *
   * AMOUNT is the honest part to get right. A limit order offers a fixed
   * quantity; a pool never runs out but gets worse continuously, so "how much
   * is available" is only answerable against a price bound. These rows offer
   * what can be traded within 1% of the quote, which is the same shape of claim
   * a limit order makes and therefore directly comparable to the rows around
   * it. For constant product that is tok*(1 - 1/sqrt(1+b)) to buy and
   * tok*(1/sqrt(1-b) - 1) to sell.
   *
   * They sort into the book by price rather than sitting above or below it,
   * because that is the order execution actually takes: best price first,
   * whichever venue holds it. On CAPTAINDAN the pool's ask lands INSIDE the
   * limit book, which is exactly what happened when a real 2,000 XCP order
   * filled pool -> book -> pool across three prices in one block.
   */
  const POOL_FEE = 0.005;
  const POOL_BAND = 0.01;
  const poolTok = Number(big(poolTokensRaw ?? 0)) / 1e8;
  const poolXcp = Number(big(poolXcpRaw ?? 0)) / 1e8;
  const poolSpot = poolTok > 0 ? poolXcp / poolTok : 0;
  const poolRows =
    poolSpot > 0
      ? [
          {
            o: null,
            isPool: true as const,
            isBuy: false,
            price: poolSpot / (1 - POOL_FEE),
            amountText: compact(poolTok * (1 - 1 / Math.sqrt(1 + POOL_BAND))),
            xcpText: (poolXcp * (Math.sqrt(1 + POOL_BAND) - 1)).toFixed(8),
          },
          {
            o: null,
            isPool: true as const,
            isBuy: true,
            price: poolSpot * (1 - POOL_FEE),
            amountText: compact(poolTok * (1 / Math.sqrt(1 - POOL_BAND) - 1)),
            xcpText: (poolXcp * (1 - Math.sqrt(1 - POOL_BAND))).toFixed(8),
          },
        ]
      : [];
  const allAsks = [...asks, ...poolRows.filter((r) => !r.isBuy)].sort((a, b) => a.price - b.price);
  const allBids = [...bids, ...poolRows.filter((r) => r.isBuy)].sort((a, b) => b.price - a.price);
  // Asks descend toward the spread and bids fall away from it, so the two rows
  // that touch in the middle are the LOWEST ask and the HIGHEST bid. That
  // adjacency is the whole point of the layout: those two numbers are the
  // spread, and any other ordering puts a pair next to each other that means
  // nothing together.
  const ordered = [...allAsks].reverse().concat(allBids);
  const spreadAt = allAsks.length;
  // The market's real spread, not the limit book's. Quoting book-only made
  // CAPTAINDAN read "12.05x apart" while the pool was quoting 1% around spot.
  const bestAsk = allAsks[0]?.price ?? null;
  const bestBid = allBids[0]?.price ?? null;
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
            ? `Holders${liveHolderCount !== null ? ` (${liveHolderCount})` : ""}`
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
            : ordered.length;
  const totalPages = Math.max(1, Math.ceil(count / PER_PAGE));
  const page = Math.min(pageParam, totalPages);
  const from = (page - 1) * PER_PAGE;

  // The addresses actually on screen, not the biggest 25 overall.
  //
  // This used to pass every minter, and the hook caps at 25 — which, with a page size of 25,
  // meant precisely the first page was ever checked. Nobody ranked 26th or lower could be
  // labelled, and the absence of the chip reads as "this address has history" when it really
  // meant "we did not look". On a launch with two hundred minters that quietly presented a
  // hundred and seventy-five of them as established.
  //
  // Following the page instead keeps the cost identical — one lookup per visible row, the same
  // ceiling the cap was there to enforce — and makes the chip mean the same thing on every page.
  const freshness = useAddressFreshness(
    minting ? minters.slice(from, from + PER_PAGE).map((r) => r.source) : [],
    blockHeight ?? 0,
  );

  const pager = totalPages > 1 && (
    <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => setParams(tab, page - 1)}
        className="rounded-md border border-gray-200 dark:border-gray-800 px-3 py-2 font-medium text-gray-600 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
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
        className="rounded-md border border-gray-200 dark:border-gray-800 px-3 py-2 font-medium text-gray-600 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* A tab strip with one destination is chrome, not navigation — just
          say what the list below is. */}
      {tabs.length > 1 ? (
        <Tabs value={tab} onValueChange={(v) => setParams(v as typeof tab, 1)}>
          <div className="border-b border-gray-200 dark:border-gray-800 p-2">
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
        <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {tabLabel(tabs[0]!)}
        </div>
      )}

      {tab === "minters" &&
        (minters.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
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
                <div className="grid grid-cols-[2rem_minmax(16.5rem,1fr)_6rem_6.5rem_4.5rem] gap-x-4 px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <span />
                  <span>Address</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Paid</span>
                  <span className="text-right">Mints</span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {minters.slice(from, from + PER_PAGE).map((r, i) => {
                    const pct = ratio(r.earned, mintersTotal) * 100;
                    return (
                      <li
                        key={r.source}
                        className="relative grid grid-cols-[2rem_minmax(16.5rem,1fr)_6rem_6.5rem_4.5rem] items-center gap-x-4 overflow-hidden px-4 py-2 text-sm"
                      >
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 bg-purple-50/70 dark:bg-purple-950/40"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                        <span className="relative z-10 text-left text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                          {from + i + 1}
                        </span>
                        <span className="relative z-10 flex items-center gap-2">
                          <AddressHoverCard
                            source={r.source}
                            className="flex items-center gap-2 font-mono text-gray-600 dark:text-gray-400 hover:text-purple-700 dark:hover:text-purple-300"
                          >
                            <Identicon address={r.source} />
                            <span className="whitespace-nowrap">{shortAddress(r.source)}</span>
                          </AddressHoverCard>
                          {/* Outside the link: an ancestor's underline paints
                              through descendant text regardless of the
                              descendant's own text-decoration, so the only way
                              to keep the chip clean is to not be inside the <a>. */}
                          {issuerSource === r.source && (
                            <span className="shrink-0 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-px text-[10px] font-medium text-purple-700 dark:text-purple-300">
                              dev
                            </span>
                          )}
                          {freshness?.newAddresses.has(r.source) && (
                            <span className="shrink-0 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              no history
                            </span>
                          )}
                        </span>
                        <span className="relative z-10 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {commas(tokenQty(r.earned, divisible))}
                        </span>
                        <span className="relative z-10 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {commasRaw(r.paid)} XCP
                        </span>
                        <span className="relative z-10 text-right tabular-nums text-gray-500 dark:text-gray-400">
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
          <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
            Loading mempool…
          </p>
        ) : pending.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Nothing queued — every mint so far has confirmed.
          </p>
        ) : (
          <>
            <p className="border-b border-gray-100 dark:border-gray-800 bg-amber-50/50 dark:bg-amber-950/40 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
              Unconfirmed and provisional — mempool mints can exceed what&apos;s
              left, get replaced, or never confirm. Only what lands on-chain
              counts.
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {pending.slice(from, from + PER_PAGE).map((p, i) => {
                const pct = ratio(p.quantity, pendingTotal) * 100;
                return (
                  <li
                    key={p.txHash}
                    className="relative flex items-center justify-between overflow-hidden px-4 py-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-amber-50 dark:bg-amber-950/40"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    <Link
                      href={`/profile/${p.source}`}
                      className="relative z-10 flex min-w-0 items-center gap-2 font-mono text-gray-600 dark:text-gray-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                    >
                      <span className="w-8 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                        {from + i + 1}
                      </span>
                      <Identicon address={p.source} />
                      <span className="truncate">{shortAddress(p.source)}</span>
                    </Link>
                    <a
                      href={`https://xcp.io/tx/${p.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="relative z-10 shrink-0 text-right text-gray-900 dark:text-gray-100 hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                    >
                      {compact(tokenQty(p.quantity, divisible))}{" "}
                      <span className="text-gray-400 dark:text-gray-500">pending</span>
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
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No orders for {asset} are waiting in the mempool.
          </p>
        ) : (
          <>
            <p className="border-b border-gray-100 dark:border-gray-800 bg-amber-50/50 dark:bg-amber-950/40 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
              Unconfirmed and provisional — these orders join the book only after confirmation.
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {pendingOrders.slice(from, from + PER_PAGE).map((o, i) => {
                const buy = o.getAsset === asset;
                return (
                  <li key={o.txHash} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <Link href={`/profile/${o.source}`} className="flex min-w-0 items-center gap-2 font-mono text-gray-600 dark:text-gray-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline">
                      <span className="w-8 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">{from + i + 1}</span>
                      <Identicon address={o.source} />
                      <span className="truncate">{shortAddress(o.source)}</span>
                    </Link>
                    <a href={`https://xcp.io/tx/${o.txHash}`} target="_blank" rel="noreferrer" className={`shrink-0 font-medium hover:underline ${buy ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
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
          <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading trades…</p>
        ) : trades.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No trades yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={PAIR_TABLE}>
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">XCP</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-4 py-2 text-right">Venue / time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {trades.slice(from, from + PER_PAGE).map((t) => {
                    const tokens = tokenQty(t.tokenRaw, divisible);
                    // block_time is missing only if a node responded without
                    // it; fall back to the block height rather than to a
                    // placeholder string.
                    const hasTime = t.time > 0;
                    const at = hasTime ? new Date(t.time * 1000) : null;
                    return (
                      <tr key={t.key}>
                        <td className={`whitespace-nowrap px-4 py-2 font-medium ${t.buy ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {t.buy ? "↗ Buy" : "↘ Sell"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {(ratio(t.xcpRaw, t.tokenRaw) / (divisible ? 1 : 1e8)).toFixed(8)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {compact(tokens)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {fixedRaw(t.xcpRaw)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <LaunchpadAddressHoverCard
                              source={t.addr}
                              asset={asset}
                              balanceRaw={holderBalance.get(t.addr)}
                              poolXcpRaw={poolXcpRaw}
                              poolTokenRaw={poolTokensRaw}
                              className="flex items-center gap-1.5 font-mono text-xs text-gray-500 dark:text-gray-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                            >
                              <Identicon address={t.addr} />
                              {shortAddress(t.addr)}
                            </LaunchpadAddressHoverCard>
                            {issuerSource === t.addr && (
                              <span className="shrink-0 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-px text-[10px] font-medium text-purple-700 dark:text-purple-300">
                                dev
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-gray-500 dark:text-gray-400">
                          <a
                            href={`https://xcp.io/tx/${t.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            title={
                              at
                                ? `${at.toUTCString()} · block ${commas(t.block)}`
                                : `Block ${commas(t.block)}`
                            }
                            className="hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                          >
                            {t.via} ·{" "}
                            {at ? (
                              <time dateTime={at.toISOString()}>
                                {timeAgo(t.time)}
                              </time>
                            ) : (
                              commas(t.block)
                            )}
                            {at && coarse && (
                              <span className="text-gray-400 dark:text-gray-500">
                                {" "}
                                · {commas(t.block)}
                              </span>
                            )}
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
          <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading holders…</p>
        ) : holderRows.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No holders found.</p>
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
            <ul className="min-w-[30rem] divide-y divide-gray-100 dark:divide-gray-800">
              {holderRows.slice(from, from + PER_PAGE).map((h, i) => {
                const pct = ratio(h.quantity, holderTotal) * 100;
                const isPool = h.address === POOL_ROW;
                const isUtxo = h.address.startsWith("utxo:");
                const soldOut = h.quantity === 0n;
                const displayedQuantity = tokenQty(h.quantity, divisible);
                const quantityText =
                  displayedQuantity > 0 && displayedQuantity < 0.01
                    ? commasRaw(h.quantity, divisible ? 8 : 0)
                    : compact(displayedQuantity);
                return (
                  <li
                    key={h.address}
                    className="relative flex items-center justify-between gap-3 overflow-hidden px-4 py-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-purple-50/70 dark:bg-purple-950/40"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    <span className="relative z-10 flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-gray-600 dark:text-gray-400">
                      <span className="w-8 text-right text-xs text-gray-400 dark:text-gray-500">
                        {from + i + 1}
                      </span>
                      {isPool ? (
                        <>
                          {/* The chip follows the LP, not the pool. Liquidity
                              whose LP is burned can never be withdrawn; whatever
                              LP someone still holds can leave at any block, and
                              captioning that "locked" would be the most
                              misleading thing this table could print. */}
                          <span aria-hidden className="text-sm">
                            {poolLock.fullyLocked ? "🔒" : "🔓"}
                          </span>
                          {/* The pool is not an address, so there is nothing
                              to resolve on an explorer — but its LP token IS an
                              asset, and that page is where the reserves, the
                              LP supply and the burn actually live. Linking the
                              row there is the only way a reader can check the
                              lock claim for themselves. */}
                          {lpAsset ? (
                            <a
                              href={`https://xcpdex.com/${lpAsset}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-sans font-medium text-gray-900 dark:text-gray-100 hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                              title={`LP token ${lpAsset}`}
                            >
                              Pool
                            </a>
                          ) : (
                            <span className="font-sans font-medium text-gray-900 dark:text-gray-100">
                              Pool
                            </span>
                          )}
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${
                              poolLock.fullyLocked
                                ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400"
                                : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                            }`}
                            title={
                              poolLock.fullyLocked
                                ? "Every LP token is burned — this liquidity can never be withdrawn."
                                : `${poolLock.lockedPercent}% of the LP is burned. The rest can be withdrawn by whoever holds it.`
                            }
                          >
                            {poolLock.lockedPercent}% locked
                          </span>
                        </>
                      ) : (
                        <>
                          <Identicon address={h.address} />
                          {isUtxo ? (
                            `${h.address.slice(0, 17)}…`
                          ) : (
                            <AddressHoverCard
                              source={h.address}
                              className="hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                            >
                              {shortAddress(h.address)}
                            </AddressHoverCard>
                          )}
                        </>
                      )}
                      {/* No "no history" tag here — freshness at mint time
                          doesn't mean anything for a holder who bought in
                          on the market; only the issuer's own row is a
                          fact worth flagging post-graduation. */}
                      {issuerSource === h.address && (
                        <span className="shrink-0 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-px text-[10px] font-medium text-purple-700 dark:text-purple-300">
                          dev
                        </span>
                      )}
                      {h.address === BURN_ADDRESS && (
                        <span
                          className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-px text-[10px] font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
                          title="Counterparty's canonical unspendable burn address"
                        >
                          🔥 burn
                        </span>
                      )}
                    </span>
                    <span className="relative z-10 ml-auto shrink-0 whitespace-nowrap text-gray-900 dark:text-gray-100">
                      {soldOut ? (
                        <span className="text-gray-400 dark:text-gray-500">0 · sold out</span>
                      ) : (
                        <>
                          {quantityText}{" "}
                          <span className="text-gray-400 dark:text-gray-500">
                            ({pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%)
                          </span>
                        </>
                      )}
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
        (!orders ? (
          <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading order book…</p>
        ) : book.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No open orders on this pair — every trade here is going through the pool.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              {/* Same shape as Trades above it: a book and a tape are the same
                  columns at different moments, so reading one should teach you
                  to read the other. */}
              <table className={PAIR_TABLE}>
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">XCP</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-4 py-2 text-right">Filled / expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {ordered.slice(from, from + PER_PAGE).map((row, i) => {
                    const { isBuy, price, amountText, xcpText } = row;
                    const pool = "isPool" in row;
                    const o = row.o;
                    const mine = o && address ? o!.source === address : false;
                    const filled = o ? 1 - ratio(o!.give_remaining, o!.give_quantity) : 0;
                    // The gap between the two sides, drawn where they meet — but
                    // only when this page actually contains the boundary, and
                    // only when both sides exist to have a gap between them.
                    const boundary =
                      from + i === spreadAt && bestAsk !== null && bestBid !== null;
                    return (
                      <Fragment key={o ? o.tx_hash : `pool-${isBuy ? "bid" : "ask"}`}>
                      {boundary && (
                        <tr className="bg-gray-50/80 dark:bg-gray-800/60">
                          <td colSpan={6} className="px-4 py-1.5 text-center text-[11px] text-gray-500 dark:text-gray-400">
                            spread{" "}
                            <span className="tabular-nums text-gray-700 dark:text-gray-300">
                              {(bestBid / (divisible ? 1 : 1e8)).toFixed(8)}
                            </span>{" "}
                            →{" "}
                            <span className="tabular-nums text-gray-700 dark:text-gray-300">
                              {(bestAsk / (divisible ? 1 : 1e8)).toFixed(8)}
                            </span>
                            {bestBid > 0 && (
                              <span className="ml-1.5 text-gray-400 dark:text-gray-500">
                                ({(bestAsk / bestBid).toFixed(2)}× apart)
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                      <tr className={mine ? "bg-purple-50/60 dark:bg-purple-950/40" : pool ? "bg-blue-50/40 dark:bg-blue-950/40" : undefined}>
                        {/* Bid and Ask, not Buy and Sell: a trade is a buy or a
                            sell because it happened, a resting order is only an
                            intent. The pool is neither side's intent — it is a
                            standing counterparty to both — so it says so. */}
                        <td className={`whitespace-nowrap px-4 py-2 font-medium ${pool ? "text-blue-700 dark:text-blue-300" : isBuy ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {pool ? "◆ Pool" : isBuy ? "↗ Bid" : "↘ Ask"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {(price / (divisible ? 1 : 1e8)).toFixed(8)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {amountText}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {xcpText}
                        </td>
                        <td className="px-3 py-2">
                          {pool ? (
                            <span className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                              constant-product pool · 0.5% fee
                            </span>
                          ) : (
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <LaunchpadAddressHoverCard
                              source={o!.source}
                              asset={asset}
                              balanceRaw={holderBalance.get(o!.source)}
                              poolXcpRaw={poolXcpRaw}
                              poolTokenRaw={poolTokensRaw}
                              className="flex items-center gap-1.5 font-mono text-xs text-gray-500 dark:text-gray-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline"
                            >
                              <Identicon address={o!.source} />
                              {shortAddress(o!.source)}
                            </LaunchpadAddressHoverCard>
                            {issuerSource === o!.source && (
                              <span className="shrink-0 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-px text-[10px] font-medium text-purple-700 dark:text-purple-300">
                                dev
                              </span>
                            )}
                            {mine && (
                              <span className="shrink-0 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-px text-[10px] font-medium text-purple-700 dark:text-purple-300">
                                you
                              </span>
                            )}
                          </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-gray-500 dark:text-gray-400">
                          {pool ? (
                            <span title="A pool never runs out, it only gets worse. This is what it can absorb before its price moves 1%.">
                              within 1%
                            </span>
                          ) : mine ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => compose.composeCancel({ offer_hash: o!.tx_hash })}
                              className="rounded-md border border-gray-300 dark:border-gray-700 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 transition-colors hover:border-red-400 dark:hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                            >
                              {busy ? "…" : "Cancel"}
                            </button>
                          ) : (
                            <>
                              {(filled * 100).toFixed(0)}% ·{" "}
                              {o!.expire_index === null ? "GTC" : commas(o!.expire_index)}
                            </>
                          )}
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager}
            {compose.status === "confirmed" && (
              <p className="border-t border-gray-100 dark:border-gray-800 px-4 py-2 text-xs text-green-700 dark:text-green-400">
                Cancel broadcast — the remainder refunds when it confirms.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    compose.reset();
                    refreshOrders();
                  }}
                >
                  Refresh
                </button>
              </p>
            )}
          </>
        ))}
    </div>
  );
}
