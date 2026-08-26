"use client";

import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/**
 * One Counterparty read, tried directly and then through our own origin.
 *
 * api.counterparty.io sits behind Google Cloud Armor, and counterparty-core
 * knows it does — `lib/api/healthz.py` carries a `/rate-limited` route
 * documented as "used as a target for Cloud Armor rate limiting rules", which
 * answers 429 WITH the CORS headers a browser needs to read it. When
 * enforcement takes that path, a rate-limited visitor gets a real status.
 *
 * When it does not — a rule that denies at the edge instead of redirecting —
 * the response is Cloud Armor's own, carries no CORS headers, and the browser
 * refuses to expose it. What reaches script is a bare TypeError: no status, no
 * body, and nothing in the network tab. Error handling keyed on a status code
 * never fires, because there is no status.
 *
 * There is no second public node to ask — dev.counterparty.io:4000 is gone and
 * nothing else answers — so the fallback is a host we run, and it is the SAME
 * ORIGIN as the page rather than a subdomain. A relay is only worth having
 * when the alternative is unreachable, and an origin the visitor already has
 * open is the one address no filter list, DNS block, or CORS policy can take
 * away.
 *
 * Second, never first. Direct stays primary so the traffic stays free and in
 * the browser, and so the only requests arriving at the relay are the ones
 * with nowhere else to go. That is not only about cost: every relayed visitor
 * shares one egress IP upstream, so making it the default would turn a
 * per-visitor rate limit into a per-site one and convert an individual outage
 * into a total one.
 *
 * PORTING NOTE — this file is copied between the XCP repos alongside
 * lib/wallet. It needs one thing from its host: a route serving RELAY_BASE
 * that forwards GET /v2/* to the node (see app/api/cp/[...path]/route.ts). A
 * repo without that route still works — the relay 404s and the direct answer
 * stands — it just gets no protection.
 */

/** Same-origin, so it is reachable exactly when the page is. */
const RELAY_BASE = "/api/cp";

/**
 * Where a Counterparty read goes when the node will not talk to this browser,
 * and null for any other URL. Only this one upstream is relayed: a route that
 * forwarded anywhere would be an open proxy wearing our own origin.
 */
export function counterpartyRelay(url: string): string | null {
  if (!url.startsWith(COUNTERPARTY_API_BASE)) return null;
  try {
    const parsed = new URL(url);
    return `${RELAY_BASE}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether asking again, from a different address, could plausibly answer
 * differently.
 *
 * 403, 429 and 5xx are about this caller or this moment. A 400 or 404 is about
 * the request, and would come back the same from anywhere — relaying those
 * doubles the traffic to learn what we already know.
 */
const relayable = (status: number) => status >= 500 || status === 403 || status === 429;

/**
 * Fetch, with the relay behind it.
 *
 * Each attempt gets its OWN deadline rather than sharing one signal. A single
 * `AbortSignal.timeout` passed to both would already be aborted by the time
 * the second attempt started whenever the first failed by timing out — which
 * is precisely the case the relay exists for, so the fallback would never run
 * in the situation that needs it most.
 *
 * A relayed attempt that is no better than the direct one is discarded: the
 * caller sees the original response and the original status, rather than a
 * confusing second-hand error about a route it never asked for.
 */
export async function relayingFetch(url: string, timeoutMs: number): Promise<Response> {
  const relay = counterpartyRelay(url);
  try {
    const direct = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!relay || !relayable(direct.status)) return direct;
    try {
      const relayed = await fetch(relay, { signal: AbortSignal.timeout(timeoutMs) });
      return relayed.ok ? relayed : direct;
    } catch {
      return direct;
    }
  } catch (error) {
    // No status to inspect: a dead network and a response the browser refused
    // to expose arrive here identically, and only one is worth a retry, so
    // both get one.
    if (!relay) throw error;
    return fetch(relay, { signal: AbortSignal.timeout(timeoutMs) });
  }
}
