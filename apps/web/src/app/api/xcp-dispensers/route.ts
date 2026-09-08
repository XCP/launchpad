import { fetchXcpDispensers } from "@/lib/api/counterparty";

/** Explicit recovery reads only the book, not the whole page's price context. */
export async function GET() {
  try {
    return Response.json({ dispensers: await fetchXcpDispensers() }, {
      headers: { "cache-control": "public, max-age=0, s-maxage=60" },
    });
  } catch {
    return Response.json({ error: "unavailable" }, {
      status: 503,
      // A failed lookup must never become a cached empty market. This short
      // application cooldown adds no automatic retries or upstream requests.
      headers: { "cache-control": "no-store", "retry-after": "15" },
    });
  }
}
