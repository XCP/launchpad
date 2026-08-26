import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/**
 * Counterparty, relayed through our own origin.
 *
 * The browser talks to api.counterparty.io directly for everything the server
 * did not already render — balances, mempool events, live mint progress — and
 * that is deliberate: it is free, it stays in the browser, and it costs this
 * worker nothing. It is also a single host that can decide to stop talking to
 * one visitor, and when it does, the whole site goes with it.
 *
 * That host sits behind Google Cloud Armor. counterparty-core knows it does —
 * `lib/api/healthz.py` carries a `/rate-limited` route documented as "used as
 * a target for Cloud Armor rate limiting rules", which answers 429 WITH the
 * CORS headers a browser needs to read it. When enforcement takes that path,
 * a rate-limited visitor gets a real status and a real message. When it does
 * not — a rule that denies at the edge instead of redirecting — the response
 * is Cloud Armor's own, carries no CORS headers at all, and the browser
 * refuses to show it to us. What reaches the page is `net::ERR_FAILED` and a
 * console line about a missing header: no status, no body, nothing to tell a
 * rate limit apart from an outage.
 *
 * There is no second public node to ask. dev.counterparty.io:4000 is gone and
 * nothing else answers, so the fallback has to be a host we run. This is that
 * host, and it is deliberately the SAME ORIGIN as the page rather than
 * api.xcp.fun: a relay is only worth having if it is reachable when the
 * alternative is not, and an origin the visitor already has open is the one
 * address no filter list, DNS block, or CORS policy can take away.
 *
 * Second, not first. Direct stays the primary path so the traffic stays free
 * and stays in the browser — and so that the only requests arriving here are
 * the ones that had nowhere else to go. That matters for more than cost: every
 * visitor relayed through this route shares one egress IP upstream, so routing
 * everyone through it by default would turn a per-visitor rate limit into a
 * per-site one and make the outage total instead of individual.
 */

/** GET only, and only onward to /v2. This forwards to a third party from our
 *  own name; there is no reason it should carry writes, and no reason it
 *  should be able to name a path the site does not already use. */
const ALLOWED_PREFIX = "v2";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (path[0] !== ALLOWED_PREFIX) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // COUNTERPARTY_API_BASE already ends in /v2, and the caller's path repeats
  // it — take the base's origin and let the caller's path be the whole path,
  // so this stays correct if the constant ever moves to a different node.
  const origin = new URL(COUNTERPARTY_API_BASE).origin;
  const search = new URL(request.url).search;
  const target = `${origin}/${path.map(encodeURIComponent).join("/")}${search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // The same deadline the direct client uses. A stalled node must not hold
      // a worker invocation open on behalf of one visitor's retry.
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
  } catch {
    return Response.json({ error: "Counterparty unreachable" }, { status: 502 });
  }

  // Pass the body through untouched — quantities in it are oversized integers
  // that the client parses losslessly, and re-encoding JSON here would round
  // them. Status travels with it, so a 404 stays a 404 rather than becoming
  // an empty success.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      // Whatever the node said about caching, or nothing. These answers are
      // per-address and per-moment; a shared cache holding them would serve
      // one visitor's balance to another.
      "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    },
  });
}
