"use client";

/**
 * BTC/USD for browser code.
 *
 * Separate module from `@/lib/api/price` because that one is server-only —
 * it reaches the explorer feed directly, which a client component cannot do
 * without putting a third-party host between a visitor and a dollar sign.
 * This reads the same number back through our own `/api/price`, so both sides
 * of a page quote one figure from one source.
 *
 * Null on failure, never a guess. Every caller treats a missing rate as "show
 * no dollar figure", which is honest; a stale or invented one gets multiplied
 * into a fee estimate and read as measured.
 */
export async function fetchBtcUsd(): Promise<number | null> {
  try {
    const res = await fetch("/api/price", { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    const { btc } = (await res.json()) as { btc?: unknown };
    return typeof btc === "number" && Number.isFinite(btc) && btc > 0 ? btc : null;
  } catch {
    return null;
  }
}
