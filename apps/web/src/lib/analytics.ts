"use client";

/**
 * Fathom Analytics — the one place that talks to `window.fathom`.
 *
 * Pageviews are automatic: the script is loaded in the root layout with
 * `data-spa="auto"`, so App Router client navigations register without a
 * route-change listener here.
 *
 * Everything below is for conversions. Two rules the rest of the app relies
 * on:
 *
 *  - It never throws and never blocks. The script is third-party, it is the
 *    first thing an ad blocker removes, and it does not load on localhost at
 *    all (Fathom requires a real http/https origin). Analytics failing must
 *    never take a broadcast confirmation down with it.
 *  - A conversion fires at most once per transaction. Every broadcast site
 *    reports from a `useEffect` keyed on compose status, which React can
 *    re-run — and the user can reload the page while the same txid is still
 *    on screen. `trackTx` dedupes on the txid itself, which is the only
 *    identifier that is genuinely unique per action.
 */

interface Fathom {
  trackEvent: (name: string, opts?: { _value?: number }) => void;
}

declare global {
  interface Window {
    fathom?: Fathom;
  }
}

/** Fathom takes `_value` in CENTS — $1.23 is 123. */
function cents(usd: number | null | undefined): number | undefined {
  if (usd === null || usd === undefined) return undefined;
  if (!Number.isFinite(usd) || usd <= 0) return undefined;
  return Math.round(usd * 100);
}

/**
 * Report one event. `usd` is a dollar amount — pass the same figure the user
 * was shown, not a separately derived one, so the dashboard and the screen
 * can never disagree.
 */
export function trackEvent(name: string, usd?: number | null): void {
  if (typeof window === "undefined" || !window.fathom) return;
  try {
    const value = cents(usd);
    window.fathom.trackEvent(name, value === undefined ? undefined : { _value: value });
  } catch {
    // A blocked or half-initialised script is not an error worth surfacing.
  }
}

const SEEN_KEY = "xcpfun:tracked:v1";

/** txids already reported, so a re-render or a reload can't double-count. */
function seen(): Set<string> {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/**
 * Report a conversion for a broadcast transaction, exactly once.
 *
 * Deduped on txid rather than on a render-scoped ref: the effects that call
 * this re-run on unrelated dependency changes, and the pending dock keeps a
 * confirmed action on screen across reloads.
 */
export function trackTx(
  txid: string | null | undefined,
  name: string,
  usd?: number | null,
): void {
  if (!txid || typeof window === "undefined") return;
  const already = seen();
  if (already.has(txid)) return;
  already.add(txid);
  try {
    // Bounded: this only has to outlive the tab, and a session that broadcast
    // 100 transactions has bigger things going on than a stale dedupe entry.
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...already].slice(-100)));
  } catch {
    // Private mode with no storage quota — fall through and still report.
  }
  trackEvent(name, usd);
}
