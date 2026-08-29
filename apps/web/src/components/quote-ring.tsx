"use client";

import { useEffect, useState } from "react";

/**
 * Quote-freshness countdown (CoW's construction): pathLength={100}
 * normalizes the circle so there's no 2πr math, and a 1s stroke transition
 * matched to the 1 Hz tick turns the discrete counter into a continuous
 * sweep. While a fetch is in flight the ring pulses instead of advancing —
 * honest state over smooth state. Wired to the REAL refresh interval.
 */
export function QuoteRing({
  periodMs,
  lastUpdated,
  fetching,
}: {
  periodMs: number;
  lastUpdated: number | null;
  fetching: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lastUpdated) return null;
  const remaining = Math.max(0, 100 - ((now - lastUpdated) / periodMs) * 100);
  return (
    <svg
      viewBox="0 0 20 20"
      className={`size-[18px] -rotate-90 ${fetching ? "animate-pulse" : ""}`}
      aria-label="Quote refresh countdown"
    >
      <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2" className="stroke-gray-200 dark:stroke-gray-700" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={fetching ? 100 : 100 - remaining}
        className="stroke-purple-500"
        style={{ transition: fetching ? "none" : "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}
