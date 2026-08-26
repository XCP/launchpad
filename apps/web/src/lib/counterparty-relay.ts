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
 * Knowing we are throttled, and acting like it.
 *
 * A rate limiter counts the requests it REJECTS. So the obvious behaviour —
 * always try direct, fall back when it fails — is the one that keeps the door
 * shut: every read during a throttle spends another rejected request against
 * the same window, and a page with a handful of pollers can hold itself out
 * indefinitely without a single one of them succeeding.
 *
 * We cannot see the limit. Cloud Armor's rules are not ours to read, there is
 * no quota header to watch, and a denial arrives with no status at all. But we
 * do not need the number: we can see the moment we cross it. After that, going
 * straight to the relay stops feeding the limiter, which is the only thing
 * that lets the window drain — and it is faster for the user, because it skips
 * an attempt already known to fail.
 *
 * The flag is shared across tabs through localStorage, which matters more than
 * it sounds: several tabs open on this site are several independent sets of
 * pollers against one per-IP budget, and they are how a person gets throttled
 * in the first place. One tab discovering it should stand the others down too.
 */
const THROTTLE_KEY = "xcpfun:cp-throttled-until";

/** Long enough for a per-minute window to drain, short enough that a false
 *  positive — being offline, say — costs one quiet minute and no more. */
const THROTTLE_MS = 60_000;

let throttledUntil = 0;

function throttled(): boolean {
  try {
    // Storage is the shared truth, read every time and in both directions. A
    // sibling tab that learned it should stand this one down; a sibling that
    // RECOVERED should let it back up, and an in-memory flag that outranked
    // storage would make this tab sit out the rest of a timer that is no
    // longer true for anyone.
    const stored = Number(localStorage.getItem(THROTTLE_KEY) ?? 0);
    throttledUntil = Number.isFinite(stored) ? stored : 0;
  } catch {
    // No storage: the in-memory flag is all this tab has, and it still
    // stands this tab down on its own.
  }
  return Date.now() < throttledUntil;
}

function noteThrottled(): void {
  throttledUntil = Date.now() + THROTTLE_MS;
  try {
    localStorage.setItem(THROTTLE_KEY, String(throttledUntil));
  } catch {
    // Guarded deliberately: a throw here reaches whatever called the read.
  }
}

/** A direct read that worked means the window has drained — say so at once
 *  rather than sitting out the rest of a timer that is no longer true. */
function noteRecovered(): void {
  if (throttledUntil === 0) return;
  throttledUntil = 0;
  try {
    localStorage.removeItem(THROTTLE_KEY);
  } catch {
    // Nothing to undo.
  }
}

/**
 * A ceiling on what one browser may push through the relay.
 *
 * Rerouting demand is not managing it. Every relayed visitor shares ONE egress
 * IP upstream, so a throttled page that simply redirects its full poll rate at
 * us is trading a limit it hit alone for one it would hit on everybody's
 * behalf — and a relay that is itself rate limited is worth nothing to anyone.
 * The relay is a lifeboat, and a lifeboat has a capacity.
 *
 * So background reads get a budget and user-driven ones do not. That split is
 * the whole design: a poller refreshing a number that is already on screen can
 * wait a cycle and nobody notices, while a person who pressed a button is
 * doing the one thing the site exists for. Under a throttle the pollers stand
 * down and the buttons keep working, which is the right way round — and it is
 * also what drains the window, because the traffic that caused it was never
 * the buttons.
 *
 * Counted per rolling minute and shared across tabs, for the same reason the
 * throttle flag is: several tabs are several sets of pollers against one
 * budget, and they are how someone gets throttled in the first place.
 */
const BUDGET_KEY = "xcpfun:cp-relay-budget";
const BUDGET_WINDOW_MS = 60_000;
/** Enough for a page to fill itself and keep its most important number
 *  current, far short of what its pollers would send unprompted. */
const BUDGET_PER_WINDOW = 8;

interface Budget {
  windowStart: number;
  used: number;
}

function readBudget(): Budget {
  const fresh = { windowStart: Date.now(), used: 0 };
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<Budget>;
    if (
      typeof parsed.windowStart !== "number" ||
      typeof parsed.used !== "number" ||
      Date.now() - parsed.windowStart >= BUDGET_WINDOW_MS
    ) {
      return fresh;
    }
    return { windowStart: parsed.windowStart, used: parsed.used };
  } catch {
    // No storage: this tab keeps its own budget, which still bounds it.
    return fresh;
  }
}

/** True when this read may use the relay, and spends one from the budget if
 *  so. User-driven reads never ask. */
function claimBudget(): boolean {
  const budget = readBudget();
  if (budget.used >= BUDGET_PER_WINDOW) return false;
  budget.used += 1;
  try {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
  } catch {
    // Guarded: a throw here would reach whatever called the read.
  }
  return true;
}

/**
 * What a background read gets when the relay is closed to it.
 *
 * A rejection rather than an empty result, because empty is a lie that
 * renders: SWR holds the value it already had and retries on its own
 * schedule, which is exactly the backing-off we want, while a fabricated
 * empty answer would paint a zero balance over a real one.
 */
export class RelayBudgetExhausted extends Error {
  constructor() {
    super("Counterparty is rate limiting this browser. Waiting before retrying.");
  }
}

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
export async function relayingFetch(
  url: string,
  timeoutMs: number,
  { essential = false }: { essential?: boolean } = {},
): Promise<Response> {
  const relay = counterpartyRelay(url);
  const viaRelay = () => fetch(relay!, { signal: AbortSignal.timeout(timeoutMs) });

  /** The relay, if this read is allowed to have it. */
  const lifeboat = async (): Promise<Response | null> => {
    if (!relay) return null;
    if (!essential && !claimBudget()) return null;
    return viaRelay();
  };

  // Known throttled: do not knock on a door we know is shut. A rate limiter
  // counts what it rejects, so a doomed direct attempt is not free — it is the
  // thing keeping the window from draining.
  if (relay && throttled()) {
    const relayed = await lifeboat();
    if (relayed) return relayed;
    throw new RelayBudgetExhausted();
  }

  try {
    const direct = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!relay) return direct;
    if (!relayable(direct.status)) {
      noteRecovered();
      return direct;
    }
    // A readable 429 is the same news as an unreadable one, and the only kind
    // we ever get to see — counterparty-core's own /rate-limited route sends
    // it with CORS headers attached.
    if (direct.status === 429 || direct.status === 403) noteThrottled();
    const relayed = await lifeboat().catch(() => null);
    return relayed?.ok ? relayed : direct;
  } catch (error) {
    // No status to inspect: a dead network and a response the browser refused
    // to expose arrive here identically. Only one is worth a retry, so both
    // get one — and both are worth standing the pollers down for, because if
    // it IS the limiter then every further attempt extends it.
    if (!relay) throw error;
    noteThrottled();
    const relayed = await lifeboat();
    if (relayed) return relayed;
    throw new RelayBudgetExhausted();
  }
}
