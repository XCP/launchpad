import { NextResponse } from "next/server";

/**
 * Daily XCP/USD, last N days.
 *
 * A portfolio chart drawn in dollars has to price each point at the rate that
 * applied THEN — multiplying an XCP series by today's rate produces a curve
 * whose shape is identical to the XCP one and whose dollar figures are wrong
 * for every point but the last.
 *
 * xcp-explorer already keeps that calendar (`prices(day, currency, usd)`,
 * backfilled to 2014), but its /v2/price page ships ~500 KB to say so. This
 * fetches it once per revalidate window, server-side, and hands clients only
 * the days a chart can actually show.
 */
const UPSTREAM = "https://api.xcp.io/v2/price";
const MAX_DAYS = 400;

interface HistoryRow {
  day: string;
  usd: number;
}

export async function GET(request: Request) {
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 60) || 60),
  );

  try {
    const res = await fetch(UPSTREAM, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 900 },
    });
    if (!res.ok) return NextResponse.json({ result: [] }, { status: 200 });
    const data = (await res.json()) as {
      result?: { history?: HistoryRow[]; xcp?: { usd?: number; day?: string } };
    };
    const history = data.result?.history ?? [];
    const tail = history
      .slice(-days)
      .map((r) => ({ day: r.day, usd: r.usd }))
      .filter((r) => typeof r.usd === "number" && r.usd > 0);

    // The current day may not be in the calendar yet; the ticker's own latest
    // reading is the right value for today rather than yesterday's close.
    const latest = data.result?.xcp;
    if (latest?.day && typeof latest.usd === "number" && latest.usd > 0) {
      if (tail[tail.length - 1]?.day !== latest.day) {
        tail.push({ day: latest.day, usd: latest.usd });
      }
    }

    return NextResponse.json(
      { result: tail },
      { headers: { "cache-control": "public, max-age=300, s-maxage=900" } },
    );
  } catch {
    return NextResponse.json({ result: [] }, { status: 200 });
  }
}
