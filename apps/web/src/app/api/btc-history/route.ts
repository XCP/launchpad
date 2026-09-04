import { NextResponse } from "next/server";

/**
 * BTC/USD history for the homepage market modal.
 *
 * Keep the third-party price feed on the server. The browser already has a
 * same-origin route for the spot price, and the chart should have the same
 * failure and caching behavior instead of adding CoinGecko to every visitor's
 * network path.
 */
const ALLOWED_DAYS = new Set([1, 7, 30, 365]);

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = ALLOWED_DAYS.has(requested) ? requested : 30;

  try {
    const upstream = new URL(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
    );
    upstream.searchParams.set("vs_currency", "usd");
    upstream.searchParams.set("days", String(days));

    const response = await fetch(upstream, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 300 },
    });
    if (!response.ok) {
      return NextResponse.json({ result: [] }, { status: 200 });
    }

    const data = (await response.json()) as { prices?: unknown[] };
    const result = (data.prices ?? [])
      .filter(
        (point): point is [number, number] =>
          Array.isArray(point) &&
          typeof point[0] === "number" &&
          Number.isFinite(point[0]) &&
          typeof point[1] === "number" &&
          Number.isFinite(point[1]) &&
          point[1] > 0,
      )
      .map(([timestamp, price]) => ({ timestamp, price }));

    return NextResponse.json(
      { result },
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json({ result: [] }, { status: 200 });
  }
}
