"use client";

import { useState } from "react";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import type { ActivityWindow, PairActivity } from "@/lib/api/counterparty";
import { commas, compact, fromSats, usd } from "@/lib/format";
import { big } from "@/lib/numeric";

/**
 * Which way the last 24 hours went, split three ways.
 *
 * Trades and volume say how much moved; DISTINCT buyers and sellers say
 * whether that was a crowd or one wallet round-tripping — which on a thin
 * market is the difference between interest and noise, and is the number
 * most sites leave out.
 *
 * Covers both venues on the pair. An order here can fill against the pool and
 * against resting orders in the same execution, so pool-only figures would
 * undercount. Direction is the taker's in both cases.
 */
const WINDOWS: { id: ActivityWindow; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
];

export function PressurePanel({
  activity,
  xcpUsd,
}: {
  activity: PairActivity;
  xcpUsd: number | null;
}) {
  const [window, setWindow] = useState<ActivityWindow>("24h");
  const volume = activity[window];
  // Nothing has ever traded — not a window worth offering tabs for.
  if (activity.all.trades === 0) return null;

  const buyVol = fromSats(volume.buyVolXcpRaw);
  const sellVol = fromSats(volume.sellVolXcpRaw);
  const money = (xcp: number) => (xcpUsd ? usd(xcp * xcpUsd) : `${compact(xcp)} XCP`);

  if (volume.trades === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-5 text-center text-sm text-gray-500">
        No trades in this window.
      </div>
    );
  }

  const rows: { left: string; right: string; leftN: number; rightN: number }[] = [
    {
      left: `${commas(volume.buys)} buys`,
      right: `${commas(volume.sells)} sells`,
      leftN: volume.buys,
      rightN: volume.sells,
    },
    {
      left: `${money(buyVol)} buy vol`,
      right: `${money(sellVol)} sell vol`,
      leftN: Number(big(volume.buyVolXcpRaw)),
      rightN: Number(big(volume.sellVolXcpRaw)),
    },
    {
      left: `${commas(volume.buyers)} buyers`,
      right: `${commas(volume.sellers)} sellers`,
      leftN: volume.buyers,
      rightN: volume.sellers,
    },
  ];

  return (
    <div className="mt-4 space-y-3 rounded-3xl border border-gray-200 bg-white p-5">
      {/* Count on the left, window on the right — the same reading order the
          rest of the site uses, and the site's own segmented control rather
          than a second grammar invented for this one panel. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-900 tabular-nums">
          {commas(volume.trades)}{" "}
          <span className="font-normal text-gray-500">
            trade{volume.trades === 1 ? "" : "s"}
          </span>
        </span>
        <Tabs value={window} onValueChange={(v) => setWindow(v as ActivityWindow)}>
          <SegmentedList variant="card">
            {WINDOWS.map((w) => (
              <SegmentedTrigger key={w.id} value={w.id} variant="card" grow={false}>
                {w.label}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Tabs>
      </div>
      {rows.map((r) => {
        const total = r.leftN + r.rightN;
        // A 50/50 bar for a zero-activity row would imply balance where there
        // is simply nothing; render it empty instead.
        const pct = total > 0 ? (r.leftN / total) * 100 : 0;
        return (
          <div key={r.left} className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm tabular-nums">
              <span className="font-medium text-green-700">{r.left}</span>
              <span className="font-medium text-red-600">{r.right}</span>
            </div>
            {/* Thinner and desaturated. Three full-width bars at full
                strength stacked up read as decoration rather than data — the
                ratio is the information, and a 1px rule carries a ratio just
                as well as a 6px one. */}
            <div className="flex h-1 overflow-hidden rounded-full bg-gray-100">
              <div className="bg-green-500/80" style={{ width: `${pct}%` }} />
              <div className="bg-red-400/80" style={{ width: `${100 - pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
