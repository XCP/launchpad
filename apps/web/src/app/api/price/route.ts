import { fetchBtcUsd } from "@/lib/api/price";

/**
 * BTC/USD, from our own origin.
 *
 * The browser used to ask mempool.space for this directly, in four separate
 * components, and that was wrong twice over.
 *
 * It was a second source for a number we already had. Every server render on
 * this site prices in dollars off the explorer's aggregate feed; the client
 * widgets priced off mempool.space's ticker. Two feeds for one number is two
 * answers, and the seam ran right down the middle of the buy panel — a fee
 * quoted in dollars by the client sat next to a total quoted in dollars by
 * the server.
 *
 * And it spent the budget that the buy flow needs. mempool.space rate-limits
 * per IP, and a rejection it generates at the edge does not carry the CORS
 * header its normal responses do — so the browser will not show it to us, and
 * a rate-limited request surfaces as `TypeError: Failed to fetch`,
 * indistinguishable from the host being blocked outright. Every visitor to a
 * launch page was spending requests against that limit for a decorative
 * dollar figure, and then the one call that actually matters — the UTXO read
 * that gates buying — was the one that got refused.
 *
 * Same origin also means unblockable: no ad blocker, DNS filter, or national
 * firewall sits between a visitor and the site they already have open.
 */

/** Ten minutes, matching the upstream feed's own revalidate. A daily
 *  aggregate does not move fast enough to be worth asking more often, and
 *  this is decoration on top of figures the server already rendered. */
const MAX_AGE = 600;

export async function GET() {
  const btc = await fetchBtcUsd();
  return Response.json(
    { btc },
    {
      headers: {
        // A brief browser TTL over a long shared one: the edge absorbs the
        // repeat traffic, and a client that reloads still re-reads within the
        // minute rather than holding a figure for ten.
        "cache-control": `public, max-age=60, s-maxage=${MAX_AGE}`,
      },
    },
  );
}
