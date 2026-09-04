"use client";

import Link from "next/link";
import { Dialog as D } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { TokenImage } from "@/components/token-image";
import { trackEvent } from "@/lib/analytics";
import { priceChangePercent } from "@/lib/market";
import { approx } from "@/lib/numeric";

type Market = "btc" | "xcp";
type Range = "1d" | "7d" | "30d" | "1y";

interface PricePoint {
  timestamp: number;
  price: number;
}

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "1d", label: "1D", days: 1 },
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "1y", label: "1Y", days: 365 },
];

const price = (market: Market, value: number | null) => {
  if (value === null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: market === "xcp" ? 2 : 0,
    maximumFractionDigits: market === "xcp" ? 2 : 0,
  });
};

const percent = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

function BtcMark({ large = false }: { large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${large ? "size-10 text-2xl" : "size-5 text-xs"} flex shrink-0 items-center justify-center rounded-full bg-orange-500 font-bold text-white`}
    >
      ₿
    </span>
  );
}

function XcpMark({ large = false }: { large?: boolean }) {
  return (
    <TokenImage
      asset="XCP"
      className={`${large ? "size-10" : "size-5"} shrink-0 rounded-full object-cover`}
    />
  );
}

/** Compact market context for the homepage, with detail kept one click away. */
export function MarketPulse({
  btcUsd,
  xcpUsd,
  btcChange30d,
  xcpChange30d,
}: {
  btcUsd: number | null;
  xcpUsd: number | null;
  btcChange30d: number | null;
  xcpChange30d: number | null;
}) {
  const [market, setMarket] = useState<Market | null>(null);
  const [range, setRange] = useState<Range>("30d");

  const open = (next: Market) => {
    setRange("30d");
    setMarket(next);
  };

  return (
    <>
      <section
        aria-label="Market prices"
        className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <TickerButton
          market="btc"
          value={btcUsd}
          change30d={btcChange30d}
          onClick={() => open("btc")}
        />
        <TickerButton
          market="xcp"
          value={xcpUsd}
          change30d={xcpChange30d}
          onClick={() => open("xcp")}
        />
      </section>

      {market !== null && (
        <MarketModal
          market={market}
          range={range}
          onRangeChange={setRange}
          onMarketChange={open}
          onOpenChange={(isOpen) => {
            if (!isOpen) setMarket(null);
          }}
          btcUsd={btcUsd}
          xcpUsd={xcpUsd}
          btcChange30d={btcChange30d}
          xcpChange30d={xcpChange30d}
        />
      )}
    </>
  );
}

function TickerButton({
  market,
  value,
  change30d,
  onClick,
}: {
  market: Market;
  value: number | null;
  change30d: number | null;
  onClick: () => void;
}) {
  const isBtc = market === "btc";
  return (
    <button
      type="button"
      onClick={() => {
        trackEvent(isBtc ? "bitcoin price opened" : "xcp price opened");
        onClick();
      }}
      aria-label={`Open ${isBtc ? "Bitcoin" : "XCP"} price`}
      className={`group h-9 min-w-0 items-center gap-2 rounded-full border bg-white dark:bg-gray-900 px-3 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 sm:w-44 ${isBtc ? "hidden sm:flex" : "flex"} ${
        isBtc
          ? "border-orange-100 dark:border-orange-950/70 hover:border-orange-300 dark:hover:border-orange-800 hover:bg-orange-50/60 dark:hover:bg-orange-950/20"
          : "border-blue-100 dark:border-blue-950/70 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
      }`}
    >
      {isBtc ? <BtcMark /> : <XcpMark />}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {price(market, value)}
        </span>
        {change30d !== null && (
          <span
            title="30-day change"
            className={`shrink-0 text-[10px] font-bold tabular-nums ${
              change30d >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {percent(change30d)}
          </span>
        )}
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        className="size-3 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 dark:text-gray-600"
      >
        <path
          d="m4.25 2.25 3.5 3.75-3.5 3.75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function MarketModal({
  market,
  range,
  onRangeChange,
  onMarketChange,
  onOpenChange,
  btcUsd,
  xcpUsd,
  btcChange30d,
  xcpChange30d,
}: {
  market: Market;
  range: Range;
  onRangeChange: (range: Range) => void;
  onMarketChange: (market: Market) => void;
  onOpenChange: (open: boolean) => void;
  btcUsd: number | null;
  xcpUsd: number | null;
  btcChange30d: number | null;
  xcpChange30d: number | null;
}) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!market) return;
    const controller = new AbortController();
    const days = RANGES.find((item) => item.id === range)!.days;

    const url =
      market === "btc"
        ? `/api/btc-history?days=${days}`
        : `/api/xcp-history?days=${days}`;

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Price history unavailable");
        const data = (await response.json()) as {
          result?: { timestamp?: number; price?: number; day?: string; usd?: number }[];
        };
        const normalized = (data.result ?? [])
          .map((point) => ({
            timestamp:
              typeof point.timestamp === "number"
                ? point.timestamp
                : Date.parse(`${point.day ?? ""}T00:00:00Z`),
            price: typeof point.price === "number" ? point.price : point.usd,
          }))
          .filter(
            (point): point is PricePoint =>
              Number.isFinite(point.timestamp) &&
              typeof point.price === "number" &&
              Number.isFinite(point.price) &&
              point.price > 0,
          );
        setPoints(normalized);
        setFailed(normalized.length === 0);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPoints([]);
        setFailed(true);
      });

    return () => controller.abort();
  }, [market, range, refresh]);

  const isBtc = market === "btc";
  const spot = isBtc ? btcUsd : xcpUsd;
  const first = points?.[0]?.price;
  const last = points?.[points.length - 1]?.price;
  const chartChange = first && last ? priceChangePercent(last, first) : null;
  const change =
    range === "30d"
      ? isBtc
        ? btcChange30d
        : xcpChange30d
      : chartChange;
  const floorSats = btcUsd && xcpUsd ? (xcpUsd / btcUsd) * 100_000_000 : null;
  const btcInXcp = btcUsd && xcpUsd ? btcUsd / xcpUsd : null;
  const startLoading = () => {
    setPoints(null);
    setFailed(false);
  };
  const retry = () => {
    startLoading();
    setRefresh((value) => value + 1);
  };

  return (
    <D.Root open onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="backdrop-fade fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <D.Content className="modal-pop fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3 shadow-2xl focus:outline-none sm:p-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <D.Title className="text-base font-bold text-gray-900 dark:text-gray-100">
                {isBtc ? "Bitcoin Price" : "XCP Price"}
              </D.Title>
              <D.Description className="text-xs text-gray-500 dark:text-gray-400">
                {isBtc ? "Bitcoin market price in USD" : "Counterparty market price in USD"}
              </D.Description>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="mr-1 flex rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-0.5"
                role="group"
                aria-label="Price market"
              >
                {(["btc", "xcp"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      if (item === market) return;
                      startLoading();
                      onMarketChange(item);
                    }}
                    aria-pressed={market === item}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase transition-colors ${
                      market === item
                        ? item === "btc"
                          ? "bg-orange-500 text-white"
                          : "bg-blue-600 text-white"
                        : "text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={retry}
                aria-label="Refresh price chart"
                className="flex size-9 items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-gray-700 dark:hover:bg-gray-900 dark:hover:text-gray-200"
              >
                ↻
              </button>
              <D.Close
                aria-label="Close"
                className="flex size-9 items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-gray-700 dark:hover:bg-gray-900 dark:hover:text-gray-200"
              >
                ✕
              </D.Close>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {isBtc ? <BtcMark large /> : <XcpMark large />}
                <div>
                  <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{isBtc ? "BTC" : "XCP"}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{isBtc ? "Bitcoin" : "Counterparty"} (USD)</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 sm:text-3xl">
                  {price(market, spot)}
                </p>
                {change !== null && (
                  <p className={`text-sm font-semibold tabular-nums ${change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {percent(change)} <span className="font-normal text-gray-400">{range.toUpperCase()}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 px-1">
            <div className="flex rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-0.5">
              {RANGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === range) return;
                    startLoading();
                    onRangeChange(item.id);
                  }}
                  aria-pressed={range === item.id}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    range === item.id
                      ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                      : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {isBtc ? (
              <a
                href="https://simpleswap.io/?from=eth-eth&to=btc-btc"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Buy BTC ↗
              </a>
            ) : (
              <Link href="/dispense" className="text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                Buy XCP →
              </Link>
            )}
          </div>

          <div className="mt-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 shadow-sm sm:p-4">
            {points === null ? (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">Loading price history…</div>
            ) : failed ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">Price history is temporarily unavailable.</p>
                <button type="button" onClick={retry} className="rounded-full border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold">Try again</button>
              </div>
            ) : (
              <MarketLineChart market={market} points={points} />
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Stat label={isBtc ? "XCP exchange rate" : "Floor price"} value={
              isBtc
                ? btcInXcp
                  ? `1 BTC = ${Math.round(btcInXcp).toLocaleString("en-US")} XCP`
                  : "—"
                : floorSats
                  ? `1 XCP = ${Math.round(approx(floorSats)).toLocaleString("en-US")} sats`
                  : "—"
            } />
            <Stat label="Data" value={isBtc ? "BTC market · cached 5 min" : "XCP market · cached 15 min"} />
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

function MarketLineChart({ market, points }: { market: Market; points: PricePoint[] }) {
  const gradientId = useId().replaceAll(":", "");
  const width = 720;
  const height = 260;
  const pad = { top: 18, right: 18, bottom: 28, left: 18 };
  const min = Math.min(...points.map((point) => point.price));
  const max = Math.max(...points.map((point) => point.price));
  const spread = max - min || Math.max(max * 0.02, 1);
  const x = (index: number) =>
    pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value: number) =>
    pad.top + (1 - (value - min) / spread) * (height - pad.top - pad.bottom);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const baseline = height - pad.bottom;
  const area = `${line} L${x(points.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;
  const color = market === "btc" ? "#f97316" : "#2563eb";
  const start = new Date(points[0]!.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = new Date(points[points.length - 1]!.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label={`${market.toUpperCase()} price history with ${points.length} points`}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((step) => (
        <line key={step} x1={pad.left} x2={width - pad.right} y1={pad.top + step * (baseline - pad.top)} y2={pad.top + step * (baseline - pad.top)} className="stroke-gray-100 dark:stroke-gray-800" strokeWidth="1" />
      ))}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {points.length === 1 && <circle cx={x(0)} cy={y(points[0]!.price)} r="4" fill={color} />}
      <text x={pad.left} y={height - 7} className="fill-gray-400 dark:fill-gray-500" fontSize="11">{start}</text>
      <text x={width - pad.right} y={height - 7} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="11">{end}</text>
    </svg>
  );
}
