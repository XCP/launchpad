import {
  fetchPendingXcpDispenses,
  fetchXcpDispensers,
} from "@/lib/api/counterparty";
import { XCP_API_BASE } from "@/lib/constants";
import { bestAskUsd } from "@launchpad/xcp69/dispenser-price";
import { discard } from "@/lib/net";

interface Ticker {
  xcp: number | null;
  btc: number | null;
  btcUsd30dAgo: number | null;
  xcpUsd30dAgo: number | null;
  xcpUsdDayAgo: number | null;
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
    if (!res.ok) {
      await discard(res);
      return {
        xcp: null,
        btc: null,
        btcUsd30dAgo: null,
        xcpUsd30dAgo: null,
        xcpUsdDayAgo: null,
      };
    }
    const result = (await res.json())?.result;
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
    const xcpDay =
      typeof result?.xcp?.day === "string" ? result.xcp.day : null;
    // The newest daily row at or before a calendar day, `days` before the
    // ticker's own day. Walked from the newest end because the calendar runs
    // back to 2014 and the answer is always near the front of it.
    const rowDaysAgo = (days: number) => {
      const target = xcpDay
        ? new Date(Date.parse(`${xcpDay}T00:00:00Z`) - days * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : null;
      return Array.isArray(result?.history) && target !== null
        ? [...result.history]
            .reverse()
            .find(
              (row: unknown) =>
                typeof row === "object" &&
                row !== null &&
                typeof (row as { day?: unknown }).day === "string" &&
                (row as { day: string }).day <= target &&
                num((row as { usd?: unknown }).usd) !== null,
            )
        : null;
    };
    const monthAgoRow = rowDaysAgo(30);
    const dayAgoRow = rowDaysAgo(1);
    return {
      xcp: num(result?.xcp?.usd),
      btc: num(result?.btc?.usd),
      btcUsd30dAgo: num(monthAgoRow?.btc),
      xcpUsd30dAgo: num(monthAgoRow?.usd),
      xcpUsdDayAgo: num(dayAgoRow?.usd),
    };
  } catch {
    return {
      xcp: null,
      btc: null,
      btcUsd30dAgo: null,
      xcpUsd30dAgo: null,
      xcpUsdDayAgo: null,
    };
  }
}

/** BTC/USD from the explorer feed. Bitcoin has a real market price and this
 *  is it — nothing about the XCP mark below applies to the BTC leg. */
export async function fetchBtcUsd(): Promise<number | null> {
  return (await fetchTicker()).btc;
}

/** BTC/USD daily close from 30 days before the current ticker day. */
export async function fetchBtcUsd30dAgo(): Promise<number | null> {
  return (await fetchTicker()).btcUsd30dAgo;
}

/** XCP/USD daily close from 30 days before the current ticker day. */
export async function fetchXcpUsd30dAgo(): Promise<number | null> {
  return (await fetchTicker()).xcpUsd30dAgo;
}

/** XCP/USD daily close from the day before the current ticker day: the
 *  dollar leg of a graduated launch's 24-hour return. The calendar's mark and
 *  the live dispenser ask are different feeds, which is why the card offers
 *  this as a switch off an XCP-denominated default rather than as the only
 *  reading. */
export async function fetchXcpUsdDayAgo(): Promise<number | null> {
  return (await fetchTicker()).xcpUsdDayAgo;
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
    if (!res.ok) {
      await discard(res);
      return [];
    }
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
  return (await fetchMarketPrices()).xcp;
}

/** One aggregate read supplies both toolbar prices and their reference dates.
 * Client callers share this snapshot instead of fetching the ticker again
 * for each price/change displayed beside it. */
export async function fetchMarketPrices(): Promise<Ticker> {
  const [ticker, dispensers, pending] = await Promise.all([
    fetchTicker(),
    fetchXcpDispensers().catch(() => []),
    fetchPendingXcpDispenses().catch(() => []),
  ]);
  return { ...ticker, xcp: bestAskUsd(dispensers, ticker.btc, pending) ?? ticker.xcp };
}
