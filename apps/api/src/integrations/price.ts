const PRICE_URL = "https://api.xcp.io/v2/price";

/**
 * Decorative current XCP/USD context for Telegram trade totals.
 * Called only when a batch actually contains a new trade, once for the whole
 * batch. A quote failure must never hold up or suppress an on-chain alert.
 */
export async function fetchXcpUsd(): Promise<number | null> {
  try {
    const res = await fetch(PRICE_URL, {
      signal: AbortSignal.timeout(6_000),
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { xcp?: { usd?: unknown } } };
    const usd = body.result?.xcp?.usd;
    return typeof usd === "number" && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}
