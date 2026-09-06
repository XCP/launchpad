"use client";

import { isRateLimited } from "@xcp/wallet-sdk";

/**
 * The footer slot a balance would have filled, when the read failed.
 *
 * Says why, because the two reasons ask for opposite behaviour. A throttle
 * clears itself in about a minute if the page is left alone, and refreshing
 * is precisely what extends it; a node outage is nobody's to fix from here.
 * Either way the action stays live — consensus checks the balance, and the
 * compose error names the shortfall if there is one.
 */
export function BalanceUnavailable({ error }: { error: Error | undefined }) {
  if (!error) return null;
  const throttled = isRateLimited(error);
  return (
    <span
      className="min-w-0 truncate text-amber-600 dark:text-amber-400"
      title={
        throttled
          ? "Counterparty is rate limiting this browser. It clears in about a minute if you leave the page alone. You can still submit — the network checks the balance."
          : "The balance could not be read. You can still submit — the network checks the balance."
      }
    >
      {throttled ? "Balance rate limited · back in a minute" : "Balance unavailable"}
    </span>
  );
}
