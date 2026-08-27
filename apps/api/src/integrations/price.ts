import { bestAskUsd } from "@launchpad/xcp69/dispenser-price";
import {
  fetchPendingXcpDispenses,
  fetchXcpDispensers,
} from "#api/integrations/counterparty";

const PRICE_URL = "https://api.xcp.io/v2/price";

/**
 * The explorer's aggregate feed. One request for both legs: BTC/USD is what
 * converts a dispenser's sats into dollars, and the explorer's own XCP mark is
 * the fallback for when the book cannot price. Two calls here would be two
 * subrequests against the same cached URL.
 */
async function fetchTicker(): Promise<{ xcp: number | null; btc: number | null }> {
  try {
    const res = await fetch(PRICE_URL, {
      signal: AbortSignal.timeout(6_000),
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!res.ok) return { xcp: null, btc: null };
    const body = (await res.json()) as {
      result?: { xcp?: { usd?: unknown }; btc?: { usd?: unknown } };
    };
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
    return { xcp: num(body.result?.xcp?.usd), btc: num(body.result?.btc?.usd) };
  } catch {
    return { xcp: null, btc: null };
  }
}

/**
 * Decorative current XCP/USD context for Telegram trade totals.
 *
 * The cheapest vendable dispenser ask converted at BTC/USD — the same mark the
 * site prints, off the same shared predicate (`@launchpad/xcp69/dispenser-price`,
 * which carries the argument for why the ask and not the explorer's ticker).
 * An alert quoting a market cap a third below the one the /ASSET page shows
 * for the same launch is the inconsistency this exists to avoid. Falls back to
 * the explorer mark when the book is empty or BTC/USD is unavailable.
 *
 * Called only when a batch actually contains a new trade, once for the whole
 * batch. A quote failure must never hold up or suppress an on-chain alert, so
 * both legs swallow their own errors and null just drops the dollar figure.
 */
export async function fetchXcpUsd(): Promise<number | null> {
  const [ticker, dispensers, pending] = await Promise.all([
    fetchTicker(),
    fetchXcpDispensers(),
    fetchPendingXcpDispenses(),
  ]);
  return bestAskUsd(dispensers, ticker.btc, pending) ?? ticker.xcp;
}
