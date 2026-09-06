import { NextResponse } from "next/server";
import { XCP_API_BASE } from "@/lib/constants";

/**
 * BTC/USD history for the homepage market modal.
 *
 * Keep the market request server-side so visitors share one cached response.
 * The XCP market feed is primary because it already supplies the BTC spot and
 * 30-day baseline printed on the homepage. Its daily BTC column makes the
 * chart and percentage use the same source, and it is reachable from the
 * Cloudflare worker where anonymous CoinGecko requests are throttled.
 */
const ALLOWED_DAYS = new Set([1, 7, 30, 365]);

interface PricePoint {
  timestamp: number;
  price: number;
}

async function fetchXcpMarket(days: number): Promise<PricePoint[]> {
  const response = await fetch(`${XCP_API_BASE}/price`, {
    signal: AbortSignal.timeout(6_000),
    next: { revalidate: 300 },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    result?: {
      history?: { day?: unknown; btc?: unknown }[];
      btc?: { day?: unknown; usd?: unknown };
    };
  };
  const result = data.result;
  const points = (result?.history ?? [])
    .slice(-(days + 1))
    .map((row): PricePoint | null => {
      const timestamp =
        typeof row.day === "string"
          ? Date.parse(`${row.day}T00:00:00Z`)
          : NaN;
      return Number.isFinite(timestamp) &&
        typeof row.btc === "number" &&
        Number.isFinite(row.btc) &&
        row.btc > 0
        ? { timestamp, price: row.btc }
        : null;
    })
    .filter((point): point is PricePoint => point !== null);

  const latest = result?.btc;
  const latestTimestamp =
    typeof latest?.day === "string"
      ? Date.parse(`${latest.day}T00:00:00Z`)
      : NaN;
  if (
    Number.isFinite(latestTimestamp) &&
    typeof latest?.usd === "number" &&
    Number.isFinite(latest.usd) &&
    latest.usd > 0
  ) {
    const point = { timestamp: latestTimestamp, price: latest.usd };
    if (points[points.length - 1]?.timestamp === latestTimestamp) {
      points[points.length - 1] = point;
    } else {
      points.push(point);
    }
  }

  return points;
}

/** CoinGecko remains a best-effort fallback if the primary feed is down. */
async function fetchCoinGecko(days: number): Promise<PricePoint[]> {
  const upstream = new URL(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
  );
  upstream.searchParams.set("vs_currency", "usd");
  upstream.searchParams.set("days", String(days));

  const response = await fetch(upstream, {
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 300 },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as { prices?: unknown[] };
  return (data.prices ?? [])
    .map((row): PricePoint | null => {
      if (!Array.isArray(row)) return null;
      const timestamp = row[0];
      const price = row[1];
      return typeof timestamp === "number" &&
        Number.isFinite(timestamp) &&
        typeof price === "number" &&
        Number.isFinite(price) &&
        price > 0
        ? { timestamp, price }
        : null;
    })
    .filter((point): point is PricePoint => point !== null);
}

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = ALLOWED_DAYS.has(requested) ? requested : 30;

  try {
    const primary = await fetchXcpMarket(days).catch(() => []);
    const result = primary.length > 0 ? primary : await fetchCoinGecko(days);

    if (result.length === 0) {
      return NextResponse.json(
        { result: [] },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      { result },
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json(
      { result: [] },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
