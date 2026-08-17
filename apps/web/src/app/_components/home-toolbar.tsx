"use client";

import Link from "next/link";
import { LaunchSearch } from "@/app/_components/launch-search";

/**
 * The homepage's own toolbar: find a launch, or start one.
 *
 * Create lives here rather than in the header. It is the one thing this page
 * is asking for, and as a permanent header fixture it competed for space with
 * the section links on every page that wasn't asking for it at all.
 */
export function HomeToolbar({
  height,
  xcpUsd,
}: {
  height: number;
  xcpUsd: number | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <LaunchSearch height={height} xcpUsd={xcpUsd} />
      <Link
        href="/create"
        className="shrink-0 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
      >
        Create
      </Link>
    </div>
  );
}
