import {
  fetchPendingXcpDispenses,
  fetchXcpDispensers,
} from "@/lib/api/counterparty";
import { XCP_API_BASE } from "@/lib/constants";
import { bestAskUsd } from "@launchpad/xcp69/dispenser-price";

interface Ticker {
  xcp: number | null;
  btc: number | null;
}

export interface DailyXcpUsd {
  day: string;
  usd: number;
}

/**
 * The explorer's aggregate feed (daily CMC aggregate; carries both legs).
 * One fetch for both — Next dedupes by URL, so the two exported readers below
 * cost a single request per render.
 */
async function fetchTicker(): Promise<Ticker> {
  try {
    const res = await fetch(`${XCP_API_BASE}/price`, {
      // Decorative context, and a failure returns null -- but only a settled
      // failure does. A stall would hold the server render open instead.
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 600 },
    });
    if (!res.ok) return { xcp: null, btc: null };
    const result = (await res.json())?.result;
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
    return { xcp: num(result?.xcp?.usd), btc: num(result?.btc?.usd) };
  } catch {
    return { xcp: null, btc: null };
  }
}

/** BTC/USD from the explorer feed. Bitcoin has a real market price and this
 *  is it — nothing about the XCP mark below applies to the BTC leg. */
export async function fetchBtcUsd(): Promise<number | null> {
  return (await fetchTicker()).btc;
}

/**
 * The explorer's own XCP mark.
 *
 * Kept separate and exported because history still runs on it: the explorer
 * keeps a daily calendar back to 2014 and the dispenser book has no past, so
 * a chart pricing each day at its own rate has exactly one source available.
 * It is also the fallback for the live mark when the book cannot answer.
 */
export async function fetchXcpUsdReference(): Promise<number | null> {
  return (await fetchTicker()).xcp;
}

/** Daily XCP/USD calendar used when an all-time XCP sum is marked to the
 * prices that actually applied. Same cached upstream as the ticker above;
 * Next can reuse the response inside a render instead of making a new market
 * data request for every trade day. */
export async function fetchXcpUsdHistory(): Promise<DailyXcpUsd[]> {
  try {
    const res = await fetch(`${XCP_API_BASE}/price`, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    const result = (await res.json())?.result as
      | { history?: { day?: unknown; usd?: unknown }[] }
      | undefined;
    return (result?.history ?? [])
      .filter(
        (row): row is { day: string; usd: number } =>
          typeof row.day === "string" &&
          typeof row.usd === "number" &&
          Number.isFinite(row.usd) &&
          row.usd > 0,
      )
      .map((row) => ({ day: row.day, usd: row.usd }));
  } catch {
    return [];
  }
}

/**
 * XCP/USD — the sitewide mark, and the input to every market cap, portfolio
 * value and dollar hint on the site.
 *
 * The cheapest vendable dispenser ask, converted at BTC/USD. See
 * `@launchpad/xcp69/dispenser-price` for why the ask is the mark rather than the
 * explorer's ticker: the book is the only venue a visitor here can actually
 * buy XCP at, and the two have run 50% apart.
 *
 * Falls back to the explorer mark, in order, when the book cannot price:
 * no open dispensers, or no BTC/USD to convert the sats with. A stale mark
 * beats no mark — every caller treats null as "hide the dollar figure", and
 * hiding every dollar figure on the site because the book emptied for one
 * block is a worse answer than the ticker.
 */
export async function fetchXcpUsd(): Promise<number | null> {
  const [ticker, dispensers, pending] = await Promise.all([
    fetchTicker(),
    fetchXcpDispensers().catch(() => []),
    fetchPendingXcpDispenses().catch(() => []),
  ]);
  return bestAskUsd(dispensers, ticker.btc, pending) ?? ticker.xcp;
}
