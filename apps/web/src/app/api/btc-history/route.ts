import { NextResponse } from "next/server";
import { approx } from "@/lib/numeric";

/**
 * BTC/USD history for the homepage market modal.
 *
 * Keep the third-party price feed on the server. The browser already has a
 * same-origin route for the spot price, and the chart should have the same
 * failure and caching behavior instead of adding CoinGecko to every visitor's
 * network path.
 */
const ALLOWED_DAYS = new Set([1, 7, 30, 365]);

interface PricePoint {
  timestamp: number;
  price: number;
}

const validPoint = (point: unknown): point is [number, number] =>
  Array.isArray(point) &&
  typeof point[0] === "number" &&
  Number.isFinite(point[0]) &&
  typeof point[1] === "number" &&
  Number.isFinite(point[1]) &&
  point[1] > 0;

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
    .filter(validPoint)
    .map(([timestamp, price]) => ({ timestamp, price }));
}

/**
 * CoinGecko's anonymous endpoint can throttle shared Cloudflare egress IPs.
 * Kraken's public OHLC feed is the fallback: hourly points cover up to 30
 * days, while daily points keep the one-year response below its 720-row cap.
 */
async function fetchKraken(days: number): Promise<PricePoint[]> {
  const upstream = new URL("https://api.kraken.com/0/public/OHLC");
  upstream.searchParams.set("pair", "XBTUSD");
  upstream.searchParams.set("interval", days <= 30 ? "60" : "1440");
  upstream.searchParams.set(
    "since",
    String(Math.floor(Date.now() / 1_000) - days * 86_400),
  );

  const response = await fetch(upstream, {
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 300 },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    error?: unknown[];
    result?: Record<string, unknown>;
  };
  if ((data.error?.length ?? 0) > 0) return [];
  const rows = Object.entries(data.result ?? {}).find(
    ([key, value]) => key !== "last" && Array.isArray(value),
  )?.[1];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row): PricePoint | null => {
      if (!Array.isArray(row)) return null;
      const timestamp = typeof row[0] === "number" ? row[0] * 1_000 : NaN;
      const close = row[4];
      const price =
        typeof close === "string" || typeof close === "number"
          ? approx(close)
          : NaN;
      return Number.isFinite(timestamp) &&
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
    const primary = await fetchCoinGecko(days).catch(() => []);
    const result = primary.length > 0 ? primary : await fetchKraken(days);

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
