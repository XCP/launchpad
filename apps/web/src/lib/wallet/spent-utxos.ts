"use client";

/**
 * Recently-spent UTXOs, tracked client-side so the next compose can tell
 * core not to offer them again.
 *
 * The gap this closes: core's own UTXOLocks (composer.py) is an in-memory,
 * per-process singleton — its own doc comment says as much: "does NOT cross
 * processes -- multi-worker deployments still need a shared store." A public
 * API server fielding real traffic is exactly that kind of deployment, so
 * two composes moments apart can land on two different workers, each with
 * its own lock table that's never heard of the other's selection — the
 * second one can pick a UTXO the first already spent, producing an
 * unsignable/rejected transaction. We don't control that infrastructure, so
 * the fix has to live here: remember what WE just spent, and tell every
 * later compose to exclude it via `exclude_utxos`, regardless of which
 * backend worker answers.
 *
 * Persisted in localStorage (same shape as pending.ts) so it survives a
 * page reload mid-sequence, not just component remounts.
 */

const KEY = "xcpfun:spent-utxos:v1";
const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 50;

interface SpentUtxo {
  utxo: string; // "txid:vout"
  addedAt: number;
}

let cache: SpentUtxo[] | null = null;

function load(): SpentUtxo[] {
  try {
    const items: SpentUtxo[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return items.filter((i) => Date.now() - i.addedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function write(items: SpentUtxo[]) {
  cache = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Private mode or quota: the exclusion just won't survive a reload.
  }
}

/** Recently-spent UTXOs still worth excluding, "txid:vout" each. */
export function recentlySpentUtxos(): string[] {
  if (typeof window === "undefined") return [];
  if (cache === null) cache = load();
  return cache.map((i) => i.utxo);
}

/**
 * How long ago our own most recent broadcast happened, or null if none is
 * tracked. `exclude_utxos` only solves "don't offer the OLD input again" —
 * it can't manufacture a NEW change output that hasn't propagated to
 * whichever of the backend's replicas answers next. A wallet down to
 * exactly one UTXO hits that gap for real: right after broadcast, the old
 * UTXO is excluded and the new change may not be visible anywhere yet, so
 * "insufficient funds" is briefly, correctly true. This is what lets a
 * caller tell that apart from an actually-empty wallet — see useCompose's
 * retry, which is the other half of this.
 */
export function msSinceLastSpend(): number | null {
  if (typeof window === "undefined") return null;
  if (cache === null) cache = load();
  if (cache.length === 0) return null;
  return Date.now() - Math.max(...cache.map((i) => i.addedAt));
}

export function registerSpentUtxos(utxos: { txid: string; vout: number }[]) {
  if (typeof window === "undefined" || utxos.length === 0) return;
  const now = Date.now();
  const existing = cache ?? load();
  const additions = utxos.map((u) => ({ utxo: `${u.txid}:${u.vout}`, addedAt: now }));
  write([...additions, ...existing].slice(0, MAX_ENTRIES));
}
