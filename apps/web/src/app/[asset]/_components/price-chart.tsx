"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { ChartCandle } from "@/lib/api/launchpad-api";
import type { ChartResolution } from "@/lib/candles";
import { commas, compact, fromSats, usd } from "@/lib/format";
import { big } from "@/lib/numeric";
import { XCP69 } from "@/lib/xcp69";

/** Mint price in XCP per token — the structural reference line. */
const MINT_PRICE = XCP69.PRICE / XCP69.QUANTITY_BY_PRICE; // 0.00001

const W = 720;
const H = 260;
const VOL_H = 44;
const PAD = { top: 12, right: 78, bottom: 22, left: 8 };
const PLOT_H = H - PAD.top - PAD.bottom - VOL_H;

export type ChartRange = "24h" | "7d" | "30d" | "all";

/**
 * Each range reads the resolution that actually resolves it. An hourly candle
 * over a year would be 8,760 slivers a pixel wide; a daily candle over 24
 * hours would be a single box. The table stores both, so the selector picks.
 */
const RANGES: {
  id: ChartRange;
  label: string;
  seconds: number;
  resolution: ChartResolution;
}[] = [
  { id: "24h", label: "24H", seconds: 86_400, resolution: "1h" },
  { id: "7d", label: "7D", seconds: 7 * 86_400, resolution: "1h" },
  { id: "30d", label: "30D", seconds: 30 * 86_400, resolution: "1d" },
  {
    id: "all",
    label: "All",
    seconds: Number.POSITIVE_INFINITY,
    resolution: "1d",
  },
];

/**
 * Smallest range that still covers the whole trading history: a pair that has
 * traded for a day opens on 24H, a week on 7D, a month on 30D, and only
 * older ones on All. Measured candle-to-candle rather than against the clock,
 * because the visible window is anchored at the newest candle too — and a
 * wall-clock read would render differently on server and client.
 */
function defaultRange(
  candles: Record<ChartResolution, ChartCandle[]>,
): ChartRange {
  const source = candles["1d"].length > 0 ? candles["1d"] : candles["1h"];
  if (source.length === 0) return "all";
  const span = source[source.length - 1]!.time - source[0]!.time;
  return RANGES.find((r) => span <= r.seconds)!.id;
}

export interface DevTrade {
  block: number;
  kind: "buy" | "sell";
}

interface Plotted {
  x: number;
  /** Body top/bottom: open and close, whichever way round they fall. */
  yOpen: number;
  yClose: number;
  yHigh: number;
  yLow: number;
  volY: number;
  up: boolean;
  /** Open and close in the denomination being DRAWN. `candle` stays raw XCP —
   *  the hover labels convert it themselves, so keeping both apart is what
   *  stops a dollar value being multiplied by the rate twice. */
  vOpen: number;
  vClose: number;
  candle: ChartCandle;
}

/** Full eight-place XCP. Axis ticks drop the unit — the axis is labelled
 *  once — but anything a reader might quote keeps it. */
const xcp = (xcpPrice: number, withUnit = false) =>
  `${xcpPrice.toLocaleString("en-US", {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  })}${withUnit ? " XCP" : ""}`;

const UP = "#15803d";
const DOWN = "#dc2626";

/**
 * TOKEN/XCP candles, read from the launchpad API's `price_candles` table.
 *
 * The table is folded from executed fills on BOTH venues — the pool and the
 * order book — because orders interleave between them and a book fill is a
 * real trade at a real price. Reserve snapshots could never have supplied the
 * per-bucket volume beneath.
 *
 * Bespoke rather than a charting library: at this density the interactions
 * worth having are a range selector, a log toggle and a crosshair, and those
 * are cheaper to write than 50KB of TradingView is to ship.
 */
export function PriceChart({
  asset,
  candles,
  xcpUsd = null,
  devTrades = [],
}: {
  asset: string;
  /** Both resolutions, so the range selector needs no round trip. */
  candles: Record<ChartResolution, ChartCandle[]>;
  xcpUsd?: number | null;
  devTrades?: DevTrade[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Plotted | null>(null);
  const [range, setRange] = useState<ChartRange>(() => defaultRange(candles));
  // Daily XCP/USD. Every candle carries a real bucket time, so each one is
  // priced at the rate of its OWN day — multiplying the whole series by
  // today's rate would draw a dollar curve that never happened.
  const { data: rates } = useSWR<{ day: string; usd: number }[]>(
    "xcp-usd-history",
    async () => {
      const res = await fetch("/api/xcp-history?days=400");
      return (
        ((await res.json()) as { result?: { day: string; usd: number }[] })
          .result ?? []
      );
    },
    { revalidateOnFocus: false },
  );
  // Line by default. These pairs trade a handful of times a day, so most
  // buckets are one fill — a candle with open == high == low == close, which
  // draws as a dash. A line through the closes reads as a price history at
  // that density; candles start earning their extra ink once buckets hold
  // several fills, so they stay one click away rather than being the default.
  const [mode, setMode] = useState<"line" | "candles">("line");
  const [log, setLog] = useState(false);
  const [inUsd, setInUsd] = useState(false);

  const hasAny = candles["1h"].length > 0 || candles["1d"].length > 0;

  /** Rate on a given day, falling back to the most recent earlier day. Never
   *  to today's rate: that is the error this exists to avoid. */
  const rateAt = useCallback(
    (unixSeconds: number): number | null => {
      if (!rates || rates.length === 0) return null;
      const day = new Date(unixSeconds * 1000).toISOString().slice(0, 10);
      let found: number | null = null;
      for (const r of rates) {
        if (r.day <= day) found = r.usd;
        else break;
      }
      return found ?? rates[0]!.usd;
    },
    [rates],
  );

  const { points, yTicks, mintPath, mintLabelY, maxVol, bodyW } =
    useMemo(() => {
      const cfg = RANGES.find((r) => r.id === range)!;
      const source = candles[cfg.resolution];
      const newest = source[source.length - 1]?.time ?? 0;
      const visible = source.filter((c) => newest - c.time <= cfg.seconds);
      if (visible.length === 0) {
        return {
          points: [],
          yTicks: [],
          mintPath: "",
          mintLabelY: 0,
          maxVol: 0n,
          bodyW: 0,
        };
      }

      // Convert BEFORE scaling, each candle at the rate of its OWN day. Doing it
      // only in the labels — which is what this did until now — left the geometry
      // in XCP, so switching to USD relabelled the axis without moving a pixel
      // and the shape silently stayed a graph of the XCP price.
      //
      // In XCP mode the rate is exactly 1, so one code path draws both.
      const valued = visible.map((candle) => {
        const rate = inUsd ? (rateAt(candle.time) ?? xcpUsd ?? 1) : 1;
        return {
          candle,
          open: candle.open * rate,
          high: candle.high * rate,
          low: candle.low * rate,
          close: candle.close * rate,
          // Fixed in XCP and therefore MOVING in dollars: every minter paid the
          // same XCP on a different day. A flat dollar line is the one claim this
          // reference must not make.
          mint: MINT_PRICE * rate,
        };
      });

      // Wicks, not closes, set the extent — a high that isn't on the axis is a
      // high the chart is hiding.
      const lo = Math.min(
        ...valued.map((v) => v.low),
        ...valued.map((v) => v.mint),
      );
      const hi = Math.max(
        ...valued.map((v) => v.high),
        ...valued.map((v) => v.mint),
      );

      // Log scaling compresses a 100× move into something readable; these prices
      // are always positive so no guard beyond the zero check is needed.
      const scale = (v: number) =>
        log ? Math.log10(Math.max(v, Number.MIN_VALUE)) : v;
      const sLo = scale(lo);
      const sHi = scale(hi);
      const spread = sHi - sLo || Math.abs(sHi) || 1;
      const yOf = (p: number) =>
        PAD.top + PLOT_H * (1 - (scale(p) - sLo) / spread);
      const innerW = W - PAD.left - PAD.right;
      const slot = innerW / visible.length;
      const xOf = (i: number) => PAD.left + slot * (i + 0.5);

      const peak = visible.reduce((m, c) => {
        const v = big(c.volumeXcpRaw);
        return v > m ? v : m;
      }, 0n);
      const volTop = PAD.top + PLOT_H + 10;
      const volOf = (v: bigint) =>
        peak > 0n ? Number((v * 1000n) / peak) / 1000 : 0;

      const plotted: Plotted[] = valued.map((v, i) => ({
        x: xOf(i),
        yOpen: yOf(v.open),
        yClose: yOf(v.close),
        yHigh: yOf(v.high),
        yLow: yOf(v.low),
        volY: volTop + (VOL_H - 10) * (1 - volOf(big(v.candle.volumeXcpRaw))),
        up: v.close >= v.open,
        vOpen: v.open,
        vClose: v.close,
        candle: v.candle,
      }));

      const ticks = [lo, log ? Math.sqrt(lo * hi) : (lo + hi) / 2, hi].map(
        (v) => ({
          v,
          y: yOf(v),
        }),
      );
      return {
        points: plotted,
        yTicks: ticks,
        mintPath: valued
          .map(
            (v, i) =>
              `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(v.mint).toFixed(1)}`,
          )
          .join(""),
        // The caption sits at the left edge, so it tracks the leftmost value.
        mintLabelY: yOf(valued[0]!.mint),
        maxVol: peak,
        // Bodies never touch: a candle keeps a gap even when hundreds are shown,
        // and never grows so wide that a handful of them read as a bar chart.
        bodyW: Math.max(1.5, Math.min(18, slot - 2)),
      };
    }, [candles, range, log, inUsd, rateAt, xcpUsd]);

  if (!hasAny) {
    return (
      <p className="rounded-md bg-gray-50 p-4 text-center text-sm text-gray-500">
        No trades yet — nothing has changed hands since the pool opened.
      </p>
    );
  }

  // The line and its fill, from the same plotted points the candles use — so
  // switching modes can never draw two different histories.
  const linePath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.yClose.toFixed(1)}`,
    )
    .join("");
  const areaPath =
    points.length > 0
      ? `${linePath}L${points[points.length - 1]!.x.toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)}L${points[0]!.x.toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)}Z`
      : "";

  const first = points[0];
  // The header's colour describes the RANGE — where it closed against where it
  // opened — not the hovered candle, which said nothing true about the chart.
  const last = points[points.length - 1];
  const rising = last && first ? last.vClose >= first.vOpen : true;

  const priceLabel = (p: number, at?: number) => {
    if (!inUsd) return xcp(p, true);
    const rate = at !== undefined ? rateAt(at) : null;
    const effective = rate ?? xcpUsd;
    return effective ? usd(p * effective) : xcp(p, true);
  };

  // A candle knows the highest block it contains, so the creator's trade —
  // which is known only by block — belongs in the first candle that reaches it.
  const devMarks = devTrades
    .map((t) => {
      const bucket = points.find((p) => p.candle.lastBlock >= t.block) ?? null;
      return bucket
        ? { ...t, x: bucket.x, y: bucket.up ? bucket.yClose : bucket.yOpen }
        : null;
    })
    .filter((m): m is DevTrade & { x: number; y: number } => m !== null)
    .filter(
      (m, i, all) =>
        all.findIndex((o) => o.x === m.x && o.kind === m.kind) === i,
    );

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = points[0]!;
    for (const p of points)
      if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
    setHover(nearest);
  };

  const control =
    "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors";
  const bucketLabel =
    RANGES.find((r) => r.id === range)!.resolution === "1h" ? "hour" : "day";

  return (
    <div className="relative">
      {/* Range on the left, how-to-draw-it on the right. The price used to sit
          here too, but the Price factoid is directly above the chart and said
          the same thing — so the row is all controls now. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-full border border-gray-200 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={`${control} ${
                range === r.id
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-full border border-gray-200 p-0.5">
            {(["line", "candles"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`${control} ${
                  mode === m
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {m === "line" ? "Line" : "Candles"}
              </button>
            ))}
          </div>
          {xcpUsd !== null && (
            <button
              type="button"
              onClick={() => setInUsd((v) => !v)}
              className={`${control} ${inUsd ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"}`}
            >
              {inUsd ? "USD" : "XCP"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLog((v) => !v)}
            aria-pressed={log}
            className={`${control} ${log ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"}`}
          >
            log
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="rounded-md bg-gray-50 p-6 text-center text-sm text-gray-500">
          No trades in this range.
        </p>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`${asset} price against ${inUsd ? "USD" : "XCP"}, ${points.length} ${bucketLabel} ${mode === "line" ? "points" : "candles"}`}
        >
          {yTicks.map((t) => (
            <g key={t.v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={t.y}
                y2={t.y}
                stroke="#f3f4f6"
                strokeWidth={1}
              />
              <text
                x={W - PAD.right + 6}
                y={t.y + 3}
                fontSize={9}
                fill="#6b7280"
              >
                {inUsd ? usd(t.v) : xcp(t.v)}
              </text>
            </g>
          ))}

          <path
            d={mintPath}
            fill="none"
            stroke="#d1d5db"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text
            x={PAD.left + 2}
            y={mintLabelY - 4}
            fontSize={10}
            fill="#6b7280"
          >
            mint price
          </text>

          {mode === "line" ? (
            <>
              <path d={areaPath} fill={rising ? UP : DOWN} opacity={0.07} />
              <path
                d={linePath}
                fill="none"
                stroke="#9333ea"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* A single bucket has no line to draw, so mark the point. */}
              {points.length === 1 && (
                <circle
                  cx={points[0]!.x}
                  cy={points[0]!.yClose}
                  r={3}
                  fill="#9333ea"
                />
              )}
            </>
          ) : (
            /* Candles: wick from high to low, body from open to close. A body
               that would round to nothing is held at 1px so a flat bucket stays
               a visible mark rather than a gap in the series. */
            points.map((p) => {
              const colour = p.up ? UP : DOWN;
              const top = Math.min(p.yOpen, p.yClose);
              const height = Math.max(1, Math.abs(p.yClose - p.yOpen));
              return (
                <g key={p.candle.time}>
                  <line
                    x1={p.x}
                    x2={p.x}
                    y1={p.yHigh}
                    y2={p.yLow}
                    stroke={colour}
                    strokeWidth={1}
                  />
                  <rect
                    x={p.x - bodyW / 2}
                    y={top}
                    width={bodyW}
                    height={height}
                    fill={colour}
                  />
                </g>
              );
            })
          )}

          {/* Volume beneath the price, on its own baseline, tinted by the
              direction of the bucket it belongs to. */}
          {points.map((p) => {
            const base = PAD.top + PLOT_H + VOL_H;
            return (
              <rect
                key={`v-${p.candle.time}`}
                x={p.x - bodyW / 2}
                y={p.volY}
                width={bodyW}
                height={Math.max(0, base - p.volY)}
                fill={mode === "line" ? "#a78bfa" : p.up ? UP : DOWN}
                opacity={mode === "line" ? 0.5 : 0.35}
              />
            );
          })}

          {devMarks.map((m) => (
            <g key={`${m.x}-${m.kind}`}>
              <title>{`Creator ${m.kind === "buy" ? "bought" : "sold"} — block ${m.block.toLocaleString()}`}</title>
              <circle
                cx={m.x}
                cy={m.y}
                r={7}
                fill={m.kind === "buy" ? UP : DOWN}
                stroke="#fff"
                strokeWidth={2}
              />
              <text
                x={m.x}
                y={m.y + 3.2}
                fontSize={8.5}
                fontWeight={700}
                fill="#fff"
                textAnchor="middle"
              >
                {m.kind === "buy" ? "B" : "S"}
              </text>
            </g>
          ))}

          {hover && mode === "line" && (
            <circle
              cx={hover.x}
              cy={hover.yClose}
              r={4}
              fill="#9333ea"
              stroke="#fff"
              strokeWidth={2}
            />
          )}

          {hover && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={PAD.top + PLOT_H + VOL_H}
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}

          <text x={PAD.left} y={H - 6} fontSize={10} fill="#6b7280">
            {points[0]
              ? new Date(points[0].candle.time * 1000).toLocaleDateString(
                  "en-US",
                  {
                    month: "short",
                    day: "numeric",
                  },
                )
              : ""}
          </text>
          <text
            x={W - PAD.right}
            y={H - 6}
            fontSize={10}
            fill="#6b7280"
            textAnchor="end"
          >
            now
          </text>
        </svg>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-max rounded-lg bg-gray-900/95 px-2.5 py-2 text-[11px] leading-relaxed text-white shadow-lg"
          style={{
            // Follows the crosshair, flipping side near the right edge so it
            // never runs off the card.
            left: `${(hover.x / W) * 100}%`,
            transform:
              hover.x > W * 0.62 ? "translateX(-105%)" : "translateX(8px)",
            top: 34,
          }}
        >
          {/* OHLC in the order every other chart puts it, so it reads without
              being labelled twice. */}
          <div className="grid grid-cols-[auto_auto] gap-x-2 tabular-nums">
            {(
              [
                ["O", hover.candle.open],
                ["H", hover.candle.high],
                ["L", hover.candle.low],
                ["C", hover.candle.close],
              ] as const
            ).map(([k, v]) => (
              <span key={k} className="contents">
                <span className="text-gray-400">{k}</span>
                <span className={k === "C" ? "font-semibold" : ""}>
                  {priceLabel(v, hover.candle.time)}
                </span>
              </span>
            ))}
          </div>
          <div className="mt-1 tabular-nums text-gray-300">
            {commas(fromSats(hover.candle.volumeXcpRaw))} XCP ·{" "}
            {hover.candle.trades} trade{hover.candle.trades === 1 ? "" : "s"}
          </div>
          <div className="text-gray-400">
            {new Date(hover.candle.time * 1000).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              ...(bucketLabel === "hour"
                ? { hour: "numeric", minute: "2-digit" }
                : {}),
            })}
          </div>
        </div>
      )}
      {points.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          {bucketLabel === "hour" ? "Hourly" : "Daily"}{" "}
          {mode === "line" ? "closes" : "candles"} from every fill on the pair —
          pool and order book. Volume beneath in XCP;{" "}
          {compact(fromSats(maxVol.toString()))} XCP is the busiest{" "}
          {bucketLabel} shown. Trend {rising ? "up" : "down"} over this range.
        </p>
      )}
    </div>
  );
}
