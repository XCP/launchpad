"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

/**
 * One polling policy for the whole site. Components still choose their own
 * refreshInterval — a mint countdown and a USD price don't want the same
 * cadence — but everything else is decided here so no widget can quietly
 * hammer a public API.
 *
 * SWR pauses intervals while the tab is hidden by default (refreshWhenHidden
 * stays off), so a page left open in a background tab costs nothing until
 * it's looked at again.
 */
export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        // Identical keys mounted by several widgets (btc-feerate, btc-usd,
        // balances) collapse into one request for this window.
        dedupingInterval: 10_000,
        // Refetch when a tab is returned to, but not on every alt-tab.
        focusThrottleInterval: 60_000,
        revalidateOnReconnect: true,
        // Give up after a few tries instead of retrying a down API forever;
        // the next interval or focus will pick it back up.
        errorRetryCount: 3,
        errorRetryInterval: 8_000,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
