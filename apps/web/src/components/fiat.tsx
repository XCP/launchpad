"use client";

import { useFiat } from "@/lib/currency";

/**
 * A dollar amount, shown in the visitor's currency.
 *
 * For server components, which cannot call `useFiat`: they compute the
 * dollars and hand them here, and this one client leaf does the formatting.
 * Everything around it stays server-rendered and cacheable.
 */
export function Fiat({ usd }: { usd: number }) {
  const format = useFiat();
  return <>{format(usd)}</>;
}
