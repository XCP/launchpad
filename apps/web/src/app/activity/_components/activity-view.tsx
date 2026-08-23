"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SegmentedList, SegmentedTrigger, Tabs, TabsContent } from "@/components/ui/tabs";
import { FOCUS } from "@/components/ui/tokens";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import {
  fetchActivityLaunches,
  fetchActivityMints,
  fetchActivityOrders,
  fetchActivityTotals,
  fetchActivityTrades,
  type ActivityLaunch,
  type ActivityMint,
  type ActivityOrder,
  type ActivityTrade,
} from "@/lib/api/launchpad-api";
import { blocksEta, commas, compact, fixedRaw, shortAddress, tokenQty } from "@/lib/format";
import { big, ratio, type RawLike } from "@/lib/numeric";

/** How many rows a tape holds. A feed is read by scrolling, not by paging, and
 *  fifty rows is about a busy day — past that the answer is a chart, and /stats
 *  is where the charts live. */
const ROWS = 50;

/** Confirmed history only moves when a block does, so polling faster than this
 *  would ask the same question of the same edge-cache entry. /mempool is the
 *  page for the ten-second horizon; this one is the ten-minute horizon. */
const REFRESH_MS = 30_000;

/** The tip, for turning a block number into "how long ago". Its own poll
 *  because it is one small Counterparty request shared by every row, where the
 *  honest alternative — a block-time lookup per row — is fifty of them. */
const HEIGHT_REFRESH_MS = 60_000;

type Tab = "mints" | "trades" | "orders" | "launches";

const TABS: { id: Tab; label: string }[] = [
  { id: "mints", label: "Mints" },
  { id: "trades", label: "Trades" },
  { id: "orders", label: "Orders" },
  { id: "launches", label: "Launches" },
];

/**
 * Everything that happened, newest first, across every launch on the site.
 *
 * /mempool answers "what is queued"; this answers "what landed". Same page
 * grammar deliberately — tabs left, refresh right, no title — because they are
 * one idea at two time horizons and a reader moving between them should not
 * have to relearn the furniture.
 *
 * The four tapes share ONE row grammar, which is what makes this a feed rather
 * than four tables stapled together: when · what · who did it · what it cost.
 * Every tab fills the same skeleton — time and block, the asset, a coloured
 * pill naming the event, a price in XCP, an amount, an XCP total, an address,
 * and one tab-specific tail column. A reader who learns to scan one row has
 * learned all four.
 *
 * Only the visible tab fetches. apps/api serves these as four routes for that
 * reason: a page built to be left open should not pay for the three feeds
 * nobody is looking at.
 */
export function ActivityView() {
  const [tab, setTab] = useState<Tab>("mints");
  // Orders only. Part of the SWR key below, so toggling it refetches the
  // narrowed feed rather than filtering a page that was already truncated.
  const [hideFilled, setHideFilled] = useState(false);

  // One row, shared by all four tab labels. Its own subscription rather than
  // a field on each feed: the counts are about the whole site, not about the
  // tab in front of you, and they should not blink when you change tabs.
  const { data: totals } = useSWR("activity:totals", fetchActivityTotals, {
    refreshInterval: REFRESH_MS,
    keepPreviousData: true,
  });

  const { data: height } = useSWR("chain-height", fetchBlockHeight, {
    refreshInterval: HEIGHT_REFRESH_MS,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  // One hook per tape, three of them parked on a null key. That is SWR's own
  // way of saying "not now" — a null key fetches nothing and schedules
  // nothing — and it keeps each feed's rows exactly typed, where a single
  // hook returning the union would need a cast per tab to get them back.
  const mints = useFeed(tab === "mints", "activity:mints", () => fetchActivityMints(ROWS));
  const trades = useFeed(tab === "trades", "activity:trades", () => fetchActivityTrades(ROWS));
  const orders = useFeed(tab === "orders", `activity:orders:${hideFilled}`, () =>
    fetchActivityOrders(ROWS, hideFilled),
  );
  const launches = useFeed(tab === "launches", "activity:launches", () =>
    fetchActivityLaunches(ROWS),
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <div className="flex items-center justify-between gap-3">
        <SegmentedList className="w-fit">
          {TABS.map((t) => {
            // Orders is the live book's size and arrives with that feed; the
            // other three are cumulative and arrive together. A count that is
            // not known yet is simply absent — a tab reading "Orders 0" before
            // the book loads is worse than one that reads "Orders".
            const n =
              t.id === "orders"
                ? (orders.data?.total ?? null)
                : t.id === "mints"
                  ? (totals?.mints ?? null)
                  : t.id === "trades"
                    ? (totals?.trades ?? null)
                    : (totals?.launches ?? null);
            return (
              <SegmentedTrigger key={t.id} value={t.id} grow={false}>
                {t.label}
                {n !== null && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400 tabular-nums">
                    {commas(n)}
                  </span>
                )}
              </SegmentedTrigger>
            );
          })}
        </SegmentedList>
        <div className="flex items-center gap-2">
          {/* Orders is the only tape with a state worth filtering out: the
              others are records of things that happened, where this one mixes
              a live book with its own history. Sits beside refresh, wearing
              the same pill the homepage's "Hide minted" wears. */}
          {tab === "orders" && (
            <label
              title="Show only orders still resting on the book"
              className="hidden cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 sm:flex"
            >
              <input
                type="checkbox"
                checked={hideFilled}
                onChange={(event) => setHideFilled(event.target.checked)}
                className="size-3.5 accent-purple-600"
              />
              <span>Hide filled</span>
            </label>
          )}
          {/* All four, because three of them are parked on a null key and
              revalidating one of those is a no-op — which is cheaper to say
              than to narrow a union of mutate signatures down to the live one. */}
          <RefreshButton
            onRefresh={() => {
              void mints.mutate();
              void trades.mutate();
              void orders.mutate();
              void launches.mutate();
            }}
          />
        </div>
      </div>

      <TabsContent value="mints" className="mt-4">
        <Feed feed={mints} empty={EMPTY.mints}>
          {(rows) => <MintTape rows={rows} height={height} />}
        </Feed>
      </TabsContent>
      <TabsContent value="trades" className="mt-4">
        <Feed feed={trades} empty={EMPTY.trades}>
          {(rows) => <TradeTape rows={rows} height={height} />}
        </Feed>
      </TabsContent>
      <TabsContent value="orders" className="mt-4">
        <Feed
          feed={{ data: orders.data && orders.data.rows, isLoading: orders.isLoading }}
          empty={hideFilled ? "Nothing resting on the book right now." : EMPTY.orders}
        >
          {(rows) => <OrderTape rows={rows} height={height} />}
        </Feed>
      </TabsContent>
      <TabsContent value="launches" className="mt-4">
        <Feed feed={launches} empty={EMPTY.launches}>
          {(rows) => <LaunchTape rows={rows} height={height} />}
        </Feed>
      </TabsContent>
    </Tabs>
  );
}

/** A tape's subscription. `keepPreviousData` is what stops the table blanking
 *  itself on every poll; the null key is what stops an unwatched tab polling
 *  at all. Generic over the whole payload rather than over a row array, because
 *  the orders feed carries the book's total beside its page. */
function useFeed<D>(active: boolean, key: string, fetcher: () => Promise<D | null>) {
  return useSWR(active ? key : null, fetcher, {
    refreshInterval: REFRESH_MS,
    keepPreviousData: true,
  });
}

/**
 * The four states every tape has, said once.
 *
 * `null` is a failed request and is deliberately not the same as `[]`: the
 * client returns null rather than an empty array precisely so a bad minute
 * cannot be reported as "nothing has ever happened here".
 */
function Feed<T>({
  feed,
  empty,
  children,
}: {
  feed: { data?: T[] | null; isLoading: boolean };
  empty: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  if (feed.data === null) {
    return (
      <Empty>
        The activity feed is unavailable right now. It will come back on its
        own.
      </Empty>
    );
  }
  if (!feed.data) return <Empty>{feed.isLoading ? "Reading the chain…" : "Nothing to show."}</Empty>;
  if (feed.data.length === 0) return <Empty>{empty}</Empty>;
  return <>{children(feed.data)}</>;
}

const EMPTY: Record<Tab, string> = {
  mints: "No mints yet — the first one will appear here.",
  trades: "Nothing has traded yet. A launch has to graduate before it has a market.",
  orders: "The book is empty — no resting orders on any XCP-69 pair.",
  launches: "No launches yet.",
};

/* --------------------------------------------------------------------- */
/* The four tapes                                                        */
/* --------------------------------------------------------------------- */

function MintTape({ rows, height }: { rows: ActivityMint[]; height?: number }) {
  return (
    <Tape columns={["When", "Asset", "Event", "Price", "Amount", "XCP", "Minter", "Status"]}>
      {rows.map((r) => (
        <tr key={r.txHash} className="transition-colors hover:bg-gray-50/70">
          <When block={r.block} height={height} txHash={r.txHash} />
          <Asset asset={r.asset} />
          <Cell>
            <Pill tone="purple">Mint</Pill>
          </Cell>
          {/* Every mint of one launch pays the same fixed price, so this
              column is flat down a run of rows — which is the point: a launch
              whose price changes between rows is not an XCP-69 launch. */}
          <Num>{priceText(r.paid, r.earned, r.divisible)}</Num>
          <Num strong>{compact(tokenQty(r.earned, r.divisible))}</Num>
          <Num strong>{fixedRaw(r.paid)}</Num>
          <Who address={r.source} />
          <Cell right>
            <span className="text-xs text-gray-500">{MINT_STATUS[r.phase]}</span>
          </Cell>
        </tr>
      ))}
    </Tape>
  );
}

/** What became of the XCP this mint escrowed. Success and failure both end at
 *  Counterparty status `closed`, so the launch's phase is the only thing that
 *  answers this — see the project's note on the launched-vs-refunded oracle. */
const MINT_STATUS: Record<ActivityMint["phase"], string> = {
  scheduled: "escrowed",
  minting: "escrowed",
  graduated: "credited",
  refunded: "refunded",
};

function TradeTape({ rows, height }: { rows: ActivityTrade[]; height?: number }) {
  return (
    <Tape columns={["When", "Asset", "Side", "Price", "Amount", "XCP", "Trader", "Venue"]}>
      {rows.map((r) => {
        // Signed from the trader's side; the tape shows magnitudes and lets
        // the Side pill carry the direction.
        const tokens = abs(r.tokenDelta);
        const xcp = abs(r.xcpDelta);
        return (
          <tr key={r.key} className="transition-colors hover:bg-gray-50/70">
            <When block={r.block} height={height} txHash={r.txHash} />
            <Asset asset={r.asset} />
            <Cell>
              <Pill tone={r.side === "buy" ? "green" : "red"}>
                {r.side === "buy" ? "Buy" : "Sell"}
              </Pill>
            </Cell>
            <Num>{priceText(xcp, tokens, r.divisible)}</Num>
            <Num strong>{compact(tokenQty(tokens, r.divisible))}</Num>
            <Num strong>{fixedRaw(xcp)}</Num>
            <Who address={r.address} />
            <Cell right>
              <span className="text-xs text-gray-500">{r.venue}</span>
            </Cell>
          </tr>
        );
      })}
    </Tape>
  );
}

/**
 * The book, in every state an order can reach.
 *
 * Three visual channels, because "what became of this offer" is three
 * questions and one pill cannot answer them all:
 *
 *  - A fill meter painted across the row, left to right, showing how much of
 *    the original size was actually taken. A background gradient rather than
 *    an absolutely-positioned bar: `position: relative` on a `<tr>` is a thing
 *    browsers have historically disagreed about, and a gradient needs no
 *    positioning at all. It is the only channel that can say "62% of it
 *    happened".
 *  - A state pill, which names the ending.
 *  - Dimmed figures on the three terminal states, so the live book — the part
 *    a reader can still trade against — stays foreground while the history
 *    behind it stays legible.
 *
 * Size and XCP are the ORIGINAL quantities, not what is left, and that is what
 * lets one column mean one thing across all five states: price, size and XCP
 * all describe the offer as it was made, while Status and the meter describe
 * what happened to it. Showing "remaining" instead would print 0 on every
 * filled row, which is the least informative number available.
 */
function OrderTape({ rows, height }: { rows: ActivityOrder[]; height?: number }) {
  return (
    <Tape columns={["When", "Asset", "Side", "Price", "Size", "XCP", "Maker", "Status"]}>
      {rows.map((r) => {
        const done = r.state !== "open" && r.state !== "partial";
        const pct = Math.round(r.filled * 100);
        return (
          <tr
            key={r.txHash}
            className={`transition-colors hover:bg-gray-50/70 ${done ? "text-gray-400" : ""}`}
            /* green-50. Anything taken is the same fact however the order
               ended, so the meter does not change colour with the state — the
               pill beside it is what says how the story finished. */
            style={
              pct > 0
                ? {
                    backgroundImage: `linear-gradient(to right, rgb(240 253 244) ${pct}%, transparent ${pct}%)`,
                  }
                : undefined
            }
          >
            <When block={r.block} height={height} txHash={r.txHash} dim={done} />
            <Asset asset={r.asset} dim={done} />
            <Cell>
              <Pill tone={done ? "gray" : r.side === "buy" ? "green" : "red"}>
                {r.side === "buy" ? "Bid" : "Ask"}
              </Pill>
            </Cell>
            <Num dim={done}>{priceText(r.xcpQuantity, r.tokenQuantity, r.divisible)}</Num>
            <Num strong dim={done}>
              {compact(tokenQty(r.tokenQuantity, r.divisible))}
            </Num>
            <Num strong dim={done}>
              {fixedRaw(r.xcpQuantity)}
            </Num>
            <Who address={r.source} dim={done} />
            <Cell right>
              <span className="block">
                <Pill tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Pill>
              </span>
              {/* One qualifying fact per state: how far a partial got, how long
                  a live order has left, or whether a dead one ever traded. */}
              <span className="mt-0.5 block text-[11px] text-gray-400 tabular-nums">
                {r.state === "partial"
                  ? `${pct}% filled`
                  : r.state === "open"
                    ? height
                      ? `${blocksEta(r.expireBlock - height)} left`
                      : ""
                    : r.state === "filled"
                      ? ""
                      : pct > 0
                        ? `${pct}% filled`
                        : "untouched"}
              </span>
            </Cell>
          </tr>
        );
      })}
    </Tape>
  );
}

const STATE_LABEL: Record<ActivityOrder["state"], string> = {
  open: "Open",
  partial: "Partial",
  filled: "Filled",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Green for the one that completed, amber for the two still in motion, gray
 *  for the two that simply stopped. Cancelled and expired share a tone on
 *  purpose: the difference is who ended it, not what the reader should do
 *  about it, and that difference is already in the label. */
const STATE_TONE: Record<ActivityOrder["state"], Tone> = {
  open: "amber",
  partial: "amber",
  filled: "green",
  cancelled: "gray",
  expired: "gray",
};

function LaunchTape({ rows, height }: { rows: ActivityLaunch[]; height?: number }) {
  return (
    <Tape columns={["When", "Asset", "Phase", "Price", "Hard cap", "Raised", "Creator", "Mints"]}>
      {rows.map((r) => (
        <tr key={r.txHash} className="transition-colors hover:bg-gray-50/70">
          <When block={r.block} height={height} txHash={r.txHash} />
          <Asset asset={r.asset} />
          <Cell>
            <Pill tone={PHASE_TONE[r.phase]}>{r.phase}</Pill>
          </Cell>
          {/* The standard's own price: XCP per quantity_by_price tokens. */}
          <Num>{priceText(r.price, r.quantityByPrice, r.divisible)}</Num>
          <Num strong>{compact(tokenQty(r.hardCap, r.divisible))}</Num>
          <Num strong>{fixedRaw(r.paid)}</Num>
          <Who address={r.source} />
          {/* Two lines, the same shape the When cell uses: the count the
              column is named for, and the one that qualifies it. "3 · 3" under
              a single header reads as a ratio nobody asked for. */}
          <Cell right>
            <span className="block text-xs text-gray-900 tabular-nums">{r.mints}</span>
            <span className="block text-[11px] text-gray-400 tabular-nums">
              {r.minters} {r.minters === 1 ? "minter" : "minters"}
            </span>
          </Cell>
        </tr>
      ))}
    </Tape>
  );
}

const PHASE_TONE: Record<ActivityLaunch["phase"], Tone> = {
  scheduled: "gray",
  minting: "amber",
  graduated: "green",
  refunded: "red",
};

/* --------------------------------------------------------------------- */
/* The shared row grammar                                                */
/* --------------------------------------------------------------------- */

/**
 * The tape's chrome: a card with a tinted header band and hairline rows.
 *
 * Deliberately neither of the two table looks already on the site. /mempool's
 * table has a white header on a white card; the launch page's trade table has
 * an uppercase micro-header, also white. This one tints the header band, which
 * gives a fifty-row feed a fixed horizon to scroll under — the thing neither of
 * the short, bounded tables above needed.
 *
 * Horizontal scroll rather than dropped columns, for the reason /mempool gives:
 * every number here is the point of the table, so none of them is the one to
 * hide on a phone.
 */
function Tape({ columns, children }: { columns: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-2xl border border-gray-200 bg-white">
      <table className="w-full min-w-[58rem] text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/80 text-left">
            {columns.map((c, i) => (
              <th
                key={c}
                className={`px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 ${
                  // The three numeric columns sit in the middle of every tape,
                  // and the tail column closes it — both right-aligned so a
                  // column of figures reads as a column.
                  i >= 3 && i <= 5 ? "text-right" : ""
                } ${i === columns.length - 1 ? "text-right" : ""}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

/**
 * When it happened, and the way into the transaction.
 *
 * Approximate by construction: nothing in the index stores a block's
 * timestamp, so this counts blocks back from the tip at the usual ten minutes
 * each. That is honest at this resolution — "~2h ago" is a claim about roughly
 * when, and the exact block sits underneath it for anyone who needs the fact
 * rather than the feeling. With no tip yet, only the block shows.
 */
function When({
  block,
  height,
  txHash,
  dim = false,
}: {
  block: number | null;
  height?: number;
  txHash: string | null;
  /** Terminal rows step back so the live ones read as foreground. */
  dim?: boolean;
}) {
  const label =
    block === null
      ? "unconfirmed"
      : height && height >= block
        ? `${blocksEta(height - block)} ago`
        : "just now";
  const body = (
    <>
      <span className={`block text-xs font-medium ${dim ? "text-gray-400" : "text-gray-900"}`}>
        {label}
      </span>
      <span className="block text-[11px] text-gray-400 tabular-nums">
        {block === null ? "—" : `#${block.toLocaleString("en-US")}`}
      </span>
    </>
  );
  return (
    <td className="whitespace-nowrap px-3 py-2">
      {txHash ? (
        <a
          href={`https://xcp.io/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className={`block hover:text-purple-700 ${FOCUS}`}
        >
          {body}
        </a>
      ) : (
        body
      )}
    </td>
  );
}

function Asset({ asset, dim = false }: { asset: string; dim?: boolean }) {
  return (
    <td className="whitespace-nowrap px-3 py-2">
      <Link
        href={`/${asset}`}
        className={`flex items-center gap-2 font-medium hover:text-purple-700 ${
          dim ? "text-gray-400" : "text-gray-900"
        } ${FOCUS}`}
      >
        <TokenImage
          asset={asset}
          className={`size-6 shrink-0 rounded object-cover ${dim ? "opacity-60" : ""}`}
        />
        {asset}
      </Link>
    </td>
  );
}

function Who({ address, dim = false }: { address: string; dim?: boolean }) {
  return (
    <td className="whitespace-nowrap px-3 py-2">
      <Link
        href={`/profile/${address}`}
        className={`font-mono text-xs hover:text-purple-700 hover:underline ${
          dim ? "text-gray-400" : "text-gray-500"
        } ${FOCUS}`}
      >
        {shortAddress(address)}
      </Link>
    </td>
  );
}

function Cell({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-3 py-2 ${right ? "text-right" : ""}`}>{children}</td>
  );
}

function Num({
  children,
  strong = false,
  dim = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
  dim?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
        dim ? "text-gray-400" : strong ? "text-gray-900" : "text-gray-500"
      }`}
    >
      {children}
    </td>
  );
}

type Tone = "green" | "red" | "purple" | "amber" | "gray";

const TONES: Record<Tone, string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  red: "border-red-200 bg-red-50 text-red-600",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  gray: "border-gray-200 bg-gray-50 text-gray-600",
};

/** The event name, as a pill rather than coloured text. Four tapes name four
 *  different kinds of thing in this column; a pill makes them read as the same
 *  kind of answer to the same question. */
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
      {children}
    </p>
  );
}

/* --------------------------------------------------------------------- */
/* Numbers                                                               */
/* --------------------------------------------------------------------- */

const abs = (raw: RawLike): bigint => {
  const v = big(raw);
  return v < 0n ? -v : v;
};

/**
 * XCP per whole token, from a raw XCP satoshi amount over a raw token amount.
 *
 * The divisor is the whole reason this is a function. Both sides are raw, so
 * for a divisible asset the 1e8 scalings cancel and the ratio is already XCP
 * per token; for an indivisible one the token side has no scaling to cancel
 * and the result is left in satoshi. Same correction the launch page's trade
 * table makes, kept in one place because four tapes now need it.
 *
 * Always eight decimals, zeros included — the same discipline fixedRaw applies
 * to the XCP columns beside it. XCP is denominated in satoshi, so eight places
 * is the full precision rather than invented digits, and padding them means a
 * column of prices lines up on the decimal point: 0.00003152 and 10.00000000
 * are instantly comparable, where "0.00003152" above "10" is not.
 */
function priceText(xcpRaw: RawLike, tokenRaw: RawLike, divisible: boolean): string {
  if (big(tokenRaw) === 0n) return "—";
  return (ratio(xcpRaw, tokenRaw) / (divisible ? 1 : 1e8)).toFixed(8);
}
