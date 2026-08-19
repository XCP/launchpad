"use client";

import Link from "next/link";
import { useState } from "react";
import { TokenImage } from "@/components/token-image";
import { fromSats, tokenQty, usd } from "@/lib/format";
import useSWR from "swr";
import { buildPortfolioSeries, rateLookup, timeLookup, type DailyRate, type TimeAnchor } from "@/lib/portfolio-chart";
import { PortfolioChart, WindowPicker, WINDOW_BLOCKS, type Window } from "@/app/profile/_components/portfolio-chart";
import { usePortfolio } from "@/app/profile/_lib/use-portfolio";
import { totalPnlXcpSats } from "@/lib/positions";

type Denom = "usd" | "xcp";

/**
 * Holdings in full, with separators — a position is a count of tokens and
 * "1.2M" hides which one. Fractions are dropped because token amounts here
 * are whole by construction (a mint buys round lots), except below one, where
 * dropping them would render the whole holding as "0".
 */
function holding(n: number): string {
  if (n > 0 && n < 1) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function Pnl({
  sats,
  format,
  unavailable,
}: {
  sats: bigint | null;
  format: (s: bigint) => string;
  unavailable?: string;
}) {
  if (sats === null)
    return <span className="text-gray-400" title={unavailable}>—</span>;
  const up = sats >= 0n;
  // Magnitude taken in integer space, before any conversion to a double —
  // the sign is carried by the label, not by the arithmetic.
  return (
    <span className={up ? "text-green-700" : "text-red-600"}>
      {up ? "+" : "−"}
      {format(up ? sats : -sats)}
    </span>
  );
}

/** Change across the visible window — the number the chart is really about.
 *  Computed on the converted values, so in dollars it reflects the move in
 *  XCP/USD as well as the move in the positions themselves. */
function PnlOverWindow({ values, format }: { values: number[]; format: (v: number) => string }) {
  const change = values[values.length - 1]! - values[0]!;
  const up = change >= 0;
  return (
    <p className={`text-sm tabular-nums ${up ? "text-green-700" : "text-red-600"}`}>
      {up ? "+" : "−"}
      {format(Math.abs(change))}
      <span className="ml-1 text-gray-400">this window</span>
    </p>
  );
}

export function PositionsTab({ address }: { address: string }) {
  const { portfolio, isLoading } = usePortfolio(address);
  const [denom, setDenom] = useState<Denom>("usd");
  const [windowKey, setWindowKey] = useState<Window>("7D");
  // Daily XCP/USD, so a dollar chart prices each point at its own day's rate.
  const { data: rates } = useSWR<DailyRate[]>("xcp-usd-history", async () => {
    const res = await fetch("/api/xcp-history?days=60");
    return ((await res.json()) as { result?: DailyRate[] }).result ?? [];
  }, { revalidateOnFocus: false });

  if (isLoading) return <p className="p-6 text-center text-sm text-gray-400">Loading positions…</p>;

  const open = portfolio?.open ?? [];
  const xcpUsd = portfolio?.xcpUsd ?? null;
  // Without a price there is only one denomination to offer.
  const showing: Denom = xcpUsd ? denom : "xcp";

  const money = (sats: bigint): string => {
    const xcp = fromSats(sats.toString());
    if (showing === "usd" && xcpUsd) return usd(xcp * xcpUsd);
    return `${xcp.toLocaleString("en-US", { maximumFractionDigits: 2 })} XCP`;
  };

  const totalXcpSats = open.reduce((sum, p) => sum + p.valueXcpSats, 0n);
  const chartComplete =
    open.every((p) => !p.withheld) && (portfolio?.closed ?? []).every((p) => !p.withheld);

  const tip = portfolio?.tipBlock ?? 0;
  const series =
    portfolio && tip > 0
      ? buildPortfolioSeries({
          deltas: portfolio.deltas,
          prices: portfolio.prices,
          fromBlock: Math.max(0, tip - WINDOW_BLOCKS[windowKey]),
          toBlock: tip,
        })
      : [];

  // Convert once, here: the chart plots numbers in whichever denomination is
  // showing, and dollars use the rate of each point's own day.
  // Real block times: every pool snapshot carries one, and the tip adds the
  // newest. No ten-minute assumption anywhere in this path.
  const anchors: TimeAnchor[] = [
    ...[...(portfolio?.prices.values() ?? [])].flat().map((sn) => ({ block: sn.block, time: sn.time })),
    ...(portfolio?.tipTime ? [{ block: tip, time: portfolio.tipTime }] : []),
  ];
  const rateAt = rateLookup(rates ?? [], timeLookup(anchors));
  const chartValues = series.map((p) => {
    const xcp = fromSats(p.xcpSats.toString());
    if (showing !== "usd") return xcp;
    return xcp * (rateAt(p.block) ?? xcpUsd ?? 0);
  });
  const chartLabel = (v: number) =>
    showing === "usd" ? usd(v) : `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} XCP`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500">Portfolio value</p>
          <p className="text-3xl font-semibold text-gray-900">{money(totalXcpSats)}</p>
          <p className="text-sm text-gray-500">
            Across {open.length} open {open.length === 1 ? "position" : "positions"}
          </p>
        </div>
        {xcpUsd && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-gray-200 p-0.5 text-xs font-medium">
            {(["usd", "xcp"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDenom(d)}
                aria-pressed={showing === d}
                className={`rounded-full px-2.5 py-1 ${
                  showing === d ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {d === "usd" ? "USD" : "XCP"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* A portfolio that has never been worth anything has nothing to chart;
          a flat line at zero with "+$0 this window" is noise, not information. */}
      {chartComplete && chartValues.length >= 2 && chartValues.some((v) => v > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <PnlOverWindow values={chartValues} format={chartLabel} />
            <WindowPicker value={windowKey} onChange={setWindowKey} />
          </div>
          <PortfolioChart values={chartValues} format={chartLabel} />
        </div>
      )}
      {!chartComplete && open.length > 0 && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          Value history is hidden because some balance movements cannot be dated reliably.
          Current holdings and values still come from live balances.
        </p>
      )}

      {open.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="mb-4 text-sm text-gray-500">No open positions in this wallet.</p>
          <Link
            href="/"
            className="inline-block rounded-2xl bg-purple-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-500"
          >
            Explore launches
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[36rem]">
            <div className="grid grid-cols-[minmax(0,1fr)_9rem_7rem_7rem] gap-x-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <span>Token</span>
              <span className="text-right">Holding</span>
              <span className="text-right">Value</span>
              <span className="text-right">Total PnL</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {open.map((p) => {
                const div = portfolio?.divisible.get(p.asset) ?? true;
                return (
                  <li
                    key={p.asset}
                    className="grid grid-cols-[minmax(0,1fr)_9rem_7rem_7rem] items-center gap-x-4 py-2.5 text-sm"
                  >
                    <Link href={`/${p.asset}`} className="flex min-w-0 items-center gap-2 hover:text-purple-600">
                      <TokenImage asset={p.asset} className="size-7 shrink-0 rounded" />
                      <span className="truncate font-medium">{p.asset}</span>
                    </Link>
                    <span className="text-right tabular-nums text-gray-600">
                      {holding(tokenQty(p.balance.toString(), div))}
                    </span>
                    <span className="text-right tabular-nums text-gray-900">
                      {money(p.valueXcpSats)}
                    </span>
                    <span className="text-right tabular-nums">
                      <Pnl
                        sats={totalPnlXcpSats(p)}
                        format={money}
                        unavailable={p.withheld}
                      />
                      {p.realizedXcpSats !== 0n && p.unrealizedXcpSats !== null && (
                        <span className="mt-0.5 block text-[10px] text-gray-400">
                          <Pnl sats={p.realizedXcpSats} format={money} /> realized
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Total PnL combines profit or loss already realized by partial sales
        with the unrealized result on tokens still held. It uses average-cost
        accounting over your indexed mint-and-trade history. It is withheld
        when transfers or incomplete activity mean that history can&apos;t be
        reconciled with your live balance.
        Positions cover graduated XCP-69 launches — the ones with a locked pool
        quoting them against XCP.
      </p>
    </div>
  );
}
