"use client";

import Link from "next/link";
import { LaunchSearch } from "@/app/_components/launch-search";
import { MarketPulse } from "@/app/_components/market-pulse";

/**
 * The homepage's own toolbar: find a launch, or start one.
 *
 * Create lives here rather than in the header. It is the one thing this page
 * is asking for, and as a permanent header fixture it competed for space with
 * the section links on every page that wasn't asking for it at all.
 */
export function HomeToolbar({
  height,
  btcUsd,
  xcpUsd,
  btcChange30d,
  xcpChange30d,
}: {
  height: number;
  btcUsd: number | null;
  xcpUsd: number | null;
  btcChange30d: number | null;
  xcpChange30d: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <LaunchSearch height={height} xcpUsd={xcpUsd} />
      <MarketPulse
        btcUsd={btcUsd}
        xcpUsd={xcpUsd}
        btcChange30d={btcChange30d}
        xcpChange30d={xcpChange30d}
      />
      <Link
        href="/create"
        className="flex h-9 shrink-0 items-center rounded-full bg-gray-900 dark:bg-gray-100 px-4 text-sm font-medium text-white dark:text-gray-900 transition-colors hover:bg-gray-700 dark:hover:bg-gray-300"
      >
        Create
      </Link>
    </div>
  );
}
