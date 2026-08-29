"use client";

import { useState } from "react";


export type Window = "1D" | "7D" | "30D";

/** ~10 minute blocks, the same average the rest of the app assumes. */
export const WINDOW_BLOCKS: Record<Window, number> = {
  "1D": 144,
  "7D": 1008,
  "30D": 4320,
};

const WINDOWS: Window[] = ["1D", "7D", "30D"];

export function WindowPicker({
  value,
  onChange,
}: {
  value: Window;
  onChange: (w: Window) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-gray-200 dark:border-gray-800 p-0.5 text-xs font-medium">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          aria-pressed={value === w}
          className={`rounded-full px-2.5 py-1 ${
            value === w ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

/**
 * An area chart of portfolio value.
 *
 * Drawn as a plain SVG path rather than pulled in from a charting library:
 * this is one series with no axes, no legend and no interaction beyond a
 * hover readout, and the whole thing is fewer lines than the import would be.
 *
 * The y-axis starts at zero deliberately. A portfolio chart auto-scaled to
 * its own min and max turns a rounding wobble into a cliff — the shape has to
 * mean something.
 */
export function PortfolioChart({
  values,
  format,
  height = 120,
}: {
  /** Already converted into the displayed denomination — in dollars each
   *  point carries the XCP/USD rate of its own day, so the USD and XCP
   *  curves are genuinely different shapes rather than one scaled copy. */
  values: number[];
  format: (v: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (values.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500"
      >
        Not enough history to chart yet.
      </div>
    );
  }

  const max = Math.max(...values, 0);
  const w = 100;
  const h = 40;
  // A flat line sits mid-height rather than pinned to the floor, so a steady
  // portfolio reads as steady instead of as nothing.
  const y = (v: number) => (max <= 0 ? h / 2 : h - (v / max) * h);
  const x = (i: number) => (i / (values.length - 1)) * w;

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  const last = values[values.length - 1]!;
  const first = values[0]!;
  const up = last >= first;
  const stroke = up ? "#15803d" : "#dc2626";
  const shown = hover === null ? values.length - 1 : hover;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`Portfolio value over time, currently ${format(values[values.length - 1]!)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          const idx = Math.round(ratio * (values.length - 1));
          setHover(Math.min(values.length - 1, Math.max(0, idx)));
        }}
      >
        <path d={area} fill={up ? "#15803d" : "#dc2626"} fillOpacity="0.08" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        <circle
          cx={x(shown)}
          cy={y(values[shown]!)}
          r="1.5"
          fill={stroke}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-0 top-0 rounded bg-gray-900/90 dark:bg-gray-100/90 px-2 py-1 text-xs text-white dark:text-gray-900 tabular-nums">
          {format(values[hover]!)}
        </div>
      )}
    </div>
  );
}
