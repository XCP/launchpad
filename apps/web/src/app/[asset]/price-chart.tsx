"use client";

import { useMemo, useRef, useState } from "react";
import type { PoolSnapshot } from "@/lib/api/counterparty";
import { price as formatPrice, usd } from "@/lib/format";
import { big, ratio } from "@/lib/numeric";
import { XCP69 } from "@/lib/xcp69";

/** Mint price in XCP per token — the structural reference line. */
const MINT_PRICE = XCP69.PRICE / XCP69.QUANTITY_BY_PRICE; // 0.00001

const W = 720;
const H = 240;
const PAD = { top: 12, right: 56, bottom: 22, left: 8 };

interface Point {
  x: number;
  y: number;
  price: number;
  block: number;
}

/**
 * TOKEN/XCP price from pool reserve snapshots: one point per state change,
 * price = XCP reserve ÷ token reserve. Single series — no legend; hover
 * crosshair + tooltip; dashed reference at mint price so "above/below mint"
 * reads at a glance.
 */
export function PriceChart({
  asset,
  history,
  blockHeight,
  xcpUsd = null,
}: {
  asset: string;
  history: PoolSnapshot[];
  blockHeight: number;
  xcpUsd?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const { points, path, area, yTicks, minPrice, maxPrice } = useMemo(() => {
    const usable = history.filter(
      (s) => big(s.reserve_a) > 0n && big(s.reserve_b) > 0n,
    );
    const prices = usable.map((s) => {
      // sort_pair puts the pair in lexical order; XCP may be either side.
      const tokenIsA = s.asset_a === asset;
      // A price is a small number and the chart is 720px wide, so a double is
      // plenty — but the reserves it comes from are 64-bit quantities, so the
      // division has to be exact before the result narrows.
      return {
        price: ratio(
          tokenIsA ? s.reserve_b : s.reserve_a,
          tokenIsA ? s.reserve_a : s.reserve_b,
        ),
        block: s.block_index,
      };
    });
    if (prices.length === 0) {
      return { points: [], path: "", area: "", yTicks: [], minPrice: 0, maxPrice: 0 };
    }
    const lo = Math.min(...prices.map((p) => p.price), MINT_PRICE);
    const hi = Math.max(...prices.map((p) => p.price), MINT_PRICE);
    const spread = hi - lo || hi || 1;
    const yOf = (p: number) =>
      PAD.top + (H - PAD.top - PAD.bottom) * (1 - (p - lo) / spread);
    const xOf = (i: number) =>
      PAD.left +
      (W - PAD.left - PAD.right) * (prices.length === 1 ? 1 : i / (prices.length - 1));
    const pts: Point[] = prices.map((p, i) => ({
      x: xOf(i),
      y: yOf(p.price),
      price: p.price,
      block: p.block,
    }));
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
    const baseline = H - PAD.bottom;
    const a = `${d}L${pts[pts.length - 1].x.toFixed(1)},${baseline}L${pts[0].x.toFixed(1)},${baseline}Z`;
    const ticks = [lo, lo + spread / 2, hi].map((v) => ({ v, y: yOf(v) }));
    return { points: pts, path: d, area: a, yTicks: ticks, minPrice: lo, maxPrice: hi };
  }, [history, asset]);

  if (points.length === 0) {
    return (
      <p className="rounded-md bg-gray-50 p-4 text-center text-sm text-gray-500">
        No trades yet — the pool opened at {formatPrice(MINT_PRICE * XCP69_OPEN_MULT)} XCP.
      </p>
    );
  }

  const last = points[points.length - 1];
  const mintY =
    PAD.top +
    (H - PAD.top - PAD.bottom) *
      (1 - (MINT_PRICE - minPrice) / (maxPrice - minPrice || 1));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = points[0];
    for (const p of points) if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
    setHover(nearest);
  };

  return (
    <div className="relative">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-lg font-bold text-gray-900">
          {formatPrice(hover ? hover.price : last.price)}{" "}
          <span className="text-sm font-normal text-gray-500">
            XCP
            {xcpUsd
              ? ` · ≈${usd((hover ? hover.price : last.price) * xcpUsd)}`
              : ""}
          </span>
        </span>
        <span className="text-xs text-gray-400">
          {hover
            ? `block ${hover.block.toLocaleString()}`
            : `${(last.price / MINT_PRICE).toFixed(2)}× mint price`}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${asset}/XCP price history, currently ${formatPrice(last.price)} XCP`}
      >
        {/* recessive grid + right-side price labels */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={W - PAD.right + 6} y={t.y + 3} fontSize={10} fill="#9ca3af">
              {formatPrice(t.v)}
            </text>
          </g>
        ))}
        {/* mint price reference */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={mintY}
          y2={mintY}
          stroke="#d1d5db"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text x={PAD.left + 2} y={mintY - 4} fontSize={10} fill="#9ca3af">
          mint price
        </text>
        <path d={area} fill="#9333ea" opacity={0.08} />
        <path d={path} fill="none" stroke="#9333ea" strokeWidth={2} strokeLinejoin="round" />
        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle cx={hover.x} cy={hover.y} r={4} fill="#9333ea" stroke="#fff" strokeWidth={2} />
          </>
        )}
        {/* x extent labels: first and last block */}
        <text x={PAD.left} y={H - 6} fontSize={10} fill="#9ca3af">
          block {points[0].block.toLocaleString()}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize={10} fill="#9ca3af" textAnchor="end">
          {last.block >= blockHeight - 1 ? "now" : `block ${last.block.toLocaleString()}`}
        </text>
      </svg>
    </div>
  );
}

const XCP69_OPEN_MULT = XCP69.SOFT_CAP / XCP69.POOL_QUANTITY;
