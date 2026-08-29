"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  btcSatsToXcp,
  continuousThresholds,
  coordinatedFirstExitPnlXcp,
  PUBLIC_MILLIONS,
  randomOrderExpectedPnlXcp,
  scenarioCashFlow,
} from "@/app/research/_lib/economics";

const money = (value: number, signed = false) =>
  `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)} XCP`;

const dollars = (value: number, signed = false) => {
  const sign = signed && value >= 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export function ExitRaceSimulator({
  xcpUsd,
  btcUsd,
  priceContext,
}: {
  xcpUsd: number;
  btcUsd: number;
  priceContext: string;
}) {
  const [addresses, setAddresses] = useState(20);
  const [priorState, setPriorState] = useState(0);
  const [sellPct, setSellPct] = useState(100);
  const [overheadSats, setOverheadSats] = useState(700);

  const prior = Math.min(priorState, PUBLIC_MILLIONS - addresses);
  const overheadXcpPerAddress = btcSatsToXcp(overheadSats, btcUsd, xcpUsd);
  const scenario = scenarioCashFlow({
    controlledAddresses: addresses,
    priorFullSellers: prior,
    sellShare: sellPct / 100,
    overheadXcpPerAddress,
  });
  const capturedPct = (addresses / PUBLIC_MILLIONS) * 100;
  const totalOverheadSats = addresses * overheadSats;

  return (
    <section id="simulator" className="scroll-mt-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold">Stress-test the exit race</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          “Coordinated first exit” is an optimistic upper bound. “Random order”
          is the expected result if all 69 full bags sell and these wallets are
          interleaved uniformly among them. Neither line asserts how many people
          actually participated.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Slider
            label="Maximum-mint addresses controlled"
            valueLabel={String(addresses)}
            value={addresses}
            min={1}
            max={PUBLIC_MILLIONS}
            step={1}
            onChange={(next) => {
              setAddresses(next);
              setPriorState((old) => Math.min(old, PUBLIC_MILLIONS - next));
            }}
          />
          <Slider
            label="Full 1M bags sold before yours"
            valueLabel={`${prior}M`}
            value={prior}
            min={0}
            max={PUBLIC_MILLIONS - addresses}
            step={1}
            onChange={setPriorState}
          />
          <Slider
            label="Share of controlled holdings sold"
            valueLabel={`${sellPct}%`}
            value={sellPct}
            min={0}
            max={100}
            step={5}
            onChange={setSellPct}
          />
          <Slider
            label="BTC overhead per address"
            valueLabel={`${overheadSats.toLocaleString()} sats`}
            value={overheadSats}
            min={0}
            max={3000}
            step={50}
            onChange={setOverheadSats}
          />
        </div>

        <p className="mt-4 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
          USD context: 1 XCP = {dollars(xcpUsd)} · 1 BTC = {dollars(btcUsd)} · {priceContext}.
          The 700-sat default is an illustrative low-fee lifecycle, not a
          measured all-in cost. Observed mint-only median: 232 sats; P90: 697.
        </p>

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="font-medium text-gray-600 dark:text-gray-400">Public allocation captured</span>
            <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {addresses}M / 69M · {capturedPct.toFixed(1)}%
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
            role="progressbar"
            aria-label="Share of public mint captured"
            aria-valuenow={capturedPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-purple-600" style={{ width: `${capturedPct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            Up to {addresses} full-cap allocations displaced only if demand
            would otherwise exceed the 69M sale.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Capital + BTC overhead"
            value={`${(scenario.capitalXcp + scenario.overheadXcp).toFixed(2)} XCP-eq`}
            hint={`${scenario.capitalXcp.toFixed(0)} XCP + ${totalOverheadSats.toLocaleString()} sats`}
          />
          <Metric
            label="Cash sale proceeds"
            value={money(scenario.proceedsXcp)}
            hint={dollars(scenario.proceedsXcp * xcpUsd)}
          />
          <Metric
            label="Net cash P/L"
            value={`${scenario.pnlXcpEquivalent >= 0 ? "+" : ""}${scenario.pnlXcpEquivalent.toFixed(2)} XCP-eq`}
            hint={dollars(scenario.pnlXcpEquivalent * xcpUsd, true)}
            negative={scenario.pnlXcpEquivalent < 0}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
          Cash accounting values the {scenario.retainedMillions.toFixed(2)}M
          unsold tokens at zero. It is intentionally not a mark-to-market
          portfolio return.
        </p>

        <ExitRaceChart
          addresses={addresses}
          selectedPnl={scenario.pnlXcpEquivalent}
          overheadXcpPerAddress={overheadXcpPerAddress}
        />
      </div>
    </section>
  );
}

function Slider({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      <span className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <strong className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">{valueLabel}</strong>
      </span>
      <input
        className="ui-slider mt-2 w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  hint,
  negative = false,
}: {
  label: string;
  value: string;
  hint: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div
        className={`mt-0.5 text-xl font-bold tabular-nums ${negative ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs tabular-nums text-gray-400 dark:text-gray-500">{hint}</div>
    </div>
  );
}

function ExitRaceChart({
  addresses,
  selectedPnl,
  overheadXcpPerAddress,
}: {
  addresses: number;
  selectedPnl: number;
  overheadXcpPerAddress: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => setWidth(Math.max(300, Math.floor(node.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const height = width < 480 ? 292 : 320;
  const margin = { top: 26, right: 16, bottom: 54, left: 64 };
  const frameWidth = width - margin.left - margin.right;
  const frameHeight = height - margin.top - margin.bottom;

  const data = useMemo(
    () =>
      Array.from({ length: PUBLIC_MILLIONS }, (_, index) => {
        const n = index + 1;
        return {
          n,
          upper: coordinatedFirstExitPnlXcp(n, overheadXcpPerAddress),
          random: randomOrderExpectedPnlXcp(n, overheadXcpPerAddress),
        };
      }),
    [overheadXcpPerAddress],
  );

  const observations = data.flatMap((point) => [point.upper, point.random]);
  observations.push(selectedPnl, 0);
  const low = Math.min(...observations);
  const high = Math.max(...observations);
  const pad = Math.max(8, (high - low) * 0.08);
  const yMin = low - pad;
  const yMax = high + pad;
  const x = (n: number) => margin.left + ((n - 1) / (PUBLIC_MILLIONS - 1)) * frameWidth;
  const y = (value: number) => margin.top + ((yMax - value) / (yMax - yMin)) * frameHeight;
  const path = (key: "upper" | "random") =>
    data
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.n).toFixed(2)},${y(point[key]).toFixed(2)}`)
      .join(" ");
  const yTicks = Array.from({ length: 6 }, (_, index) => yMin + ((yMax - yMin) * index) / 5);
  const xTicks = width < 480 ? [1, 23, 46, 69] : [1, 15, 30, 45, 60, 69];
  const selectedX = x(addresses);
  const selectedY = y(selectedPnl);
  const zeroY = y(0);
  const labelAtEnd = selectedX > margin.left + frameWidth * 0.72;
  const thresholds = continuousThresholds(overheadXcpPerAddress);

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-purple-600" aria-hidden />
          Coordinated first exit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 border-t-2 border-dashed border-orange-500" aria-hidden />
          Random position among 69 sellers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-green-500" aria-hidden />
          Selected scenario
        </span>
      </div>
      <div ref={container} className="w-full">
        <svg
          className="block w-full"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Net cash profit or loss by number of controlled maximum-mint addresses"
        >
          <rect
            x={margin.left}
            y={margin.top}
            width={frameWidth}
            height={frameHeight}
            className="fill-white stroke-gray-200 dark:fill-gray-900 dark:stroke-gray-700"
          />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + frameWidth}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-gray-200 dark:stroke-gray-700"
              />
              <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" className="fill-gray-500 dark:fill-gray-400">
                {Math.round(tick)}
              </text>
            </g>
          ))}
          {yMin < 0 && yMax > 0 && (
            <line
              x1={margin.left}
              x2={margin.left + frameWidth}
              y1={zeroY}
              y2={zeroY}
              className="stroke-gray-500 dark:stroke-gray-400"
            />
          )}
          {xTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={margin.top + frameHeight}
                y2={margin.top + frameHeight + 5}
                className="stroke-gray-300 dark:stroke-gray-600"
              />
              <text
                x={x(tick)}
                y={margin.top + frameHeight + 20}
                textAnchor={tick === 1 ? "start" : tick === 69 ? "end" : "middle"}
                fontSize="11"
                className="fill-gray-500 dark:fill-gray-400"
              >
                {tick}
              </text>
            </g>
          ))}
          <path d={path("upper")} fill="none" stroke="#9333ea" strokeWidth="2.5" />
          <path
            d={path("random")}
            fill="none"
            stroke="#f97316"
            strokeWidth="2.5"
            strokeDasharray="6 5"
          />
          <line
            x1={selectedX}
            x2={selectedX}
            y1={Math.max(margin.top, Math.min(margin.top + frameHeight, zeroY))}
            y2={selectedY}
            stroke="#22c55e"
            strokeWidth="1.5"
          />
          <circle cx={selectedX} cy={selectedY} r="5" fill="#22c55e" />
          <text
            x={selectedX + (labelAtEnd ? -8 : 8)}
            y={Math.max(margin.top + 12, Math.min(margin.top + frameHeight - 6, selectedY - 8))}
            textAnchor={labelAtEnd ? "end" : "start"}
            fontSize="11"
            fontWeight="600"
            className="fill-gray-900 dark:fill-gray-100"
          >
            {money(selectedPnl, true)}
          </text>
          {width >= 560 && (
            <text
              x={x(Math.max(1, Math.min(69, thresholds.breakEven))) + 7}
              y={y(0) - 8}
              fontSize="11"
              fontWeight="600"
              className="fill-gray-900 dark:fill-gray-100"
            >
              coordinated break-even ≈ {thresholds.breakEven.toFixed(1)}
            </text>
          )}
          <text
            x={margin.left + frameWidth / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            className="fill-gray-700 dark:fill-gray-300"
          >
            maximum-mint addresses controlled
          </text>
          <text
            x="14"
            y={margin.top + frameHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${margin.top + frameHeight / 2})`}
            fontSize="11"
            className="fill-gray-700 dark:fill-gray-300"
          >
            cash P/L (XCP-equivalent)
          </text>
        </svg>
      </div>
    </div>
  );
}
