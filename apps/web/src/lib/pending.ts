"use client";

/**
 * The pending registry: broadcast-but-unresolved actions, persisted in
 * localStorage so they survive navigation and reloads. With ten-minute
 * blocks, leaving the page mid-wait is rational — the dock keeps the
 * truth in view wherever the user goes.
 *
 * Snapshot discipline: useSyncExternalStore requires referentially stable
 * snapshots, so reads serve a module-level cache that is only replaced on
 * writes (or cross-tab storage events). Returning a fresh JSON.parse per
 * read caused an infinite render loop (React #185).
 */

import { sumRaw } from "@/lib/numeric";

export type PendingKind = "order" | "dispense" | "mint" | "pool" | "launch";

export interface PendingSpend {
  asset: string;
  raw: string;
}

export interface PendingItem {
  txid: string;
  kind: PendingKind;
  label: string;
  addedAt: number;
  /** The address that broadcast this — items follow their account, not
   *  the browser. Absent only on legacy rows, which age out in 48h. */
  address?: string;
  /** Resolved state, set by the dock's poller. */
  resolved?: string;
  /** When it resolved, so a finished action can retire itself. Stamped by
   *  updatePending rather than by each call site, which is what keeps it
   *  impossible to record an outcome without recording when. */
  resolvedAt?: number;
  /** What this action spends, for optimistic balance display.
   *  A decimal STRING: this row is JSON in localStorage, and a raw quantity
   *  can be larger than JSON.parse would hand back intact on the way out. */
  giveAsset?: string;
  giveRaw?: string;
  /** All assets this action debits. Pool deposits spend two assets; keeping
   *  this as a list avoids pretending one side is the whole transaction. */
  spends?: PendingSpend[];
  /** Consecutive authoritative 404s — 3 marks the tx dropped. */
  misses?: number;
}

const KEY = "xcpfun:pending:v1";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const EVENT = "xcpfun:pending-updated";
const EMPTY: PendingItem[] = [];

let cache: PendingItem[] | null = null;

function load(): PendingItem[] {
  try {
    const items: PendingItem[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return items.filter((i) => Date.now() - i.addedAt < MAX_AGE_MS);
  } catch {
    return EMPTY;
  }
}

export function readPending(): PendingItem[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache === null) cache = load();
  return cache;
}

/** Stable server-side snapshot for useSyncExternalStore. */
export function readPendingServer(): PendingItem[] {
  return EMPTY;
}

function write(items: PendingItem[]) {
  cache = items;
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT));
}

export function registerPending(item: Omit<PendingItem, "addedAt">) {
  const items = readPending();
  if (items.some((i) => i.txid === item.txid)) return;
  write([{ ...item, addedAt: Date.now() }, ...items].slice(0, 20));
}

export function updatePending(txid: string, patch: Partial<PendingItem>) {
  write(
    readPending().map((i) => {
      if (i.txid !== txid) return i;
      const next = { ...i, ...patch };
      // Stamp the moment of resolution once, on the transition. Re-stamping
      // on every later patch would keep pushing the retirement clock back.
      if (patch.resolved && !i.resolved) next.resolvedAt = Date.now();
      return next;
    }),
  );
}

/**
 * Retire actions that finished a while ago.
 *
 * The dock exists to answer "did it land?", and once it has, the answer stops
 * being news. Leaving resolved rows in place turned the dock into a permanent
 * receipt drawer that only ever grew, and made "3 pending" mean "3 things,
 * some of which finished yesterday". Resolved rows are still dismissible by
 * hand — this is just the sweep for the ones nobody bothers to close.
 */
export function sweepResolved(maxAgeMs: number) {
  const now = Date.now();
  const items = readPending();
  const keep = items.filter(
    (i) => !i.resolved || now - (i.resolvedAt ?? i.addedAt) < maxAgeMs,
  );
  // Only write when something actually leaves — this runs on a timer, and an
  // unconditional write would notify every subscriber on every tick.
  if (keep.length !== items.length) write(keep);
}

export function dismissPending(txid: string) {
  write(readPending().filter((i) => i.txid !== txid));
}

/**
 * Raw units of `asset` spent by still-unresolved pending actions. The
 * subtraction's lifetime is capped at ~6 blocks independently of the row's
 * 48h visibility: past that, the row stays visible as unconfirmed but the
 * balance stops lying in the conservative direction — the structural fix
 * for phantom subtractions, even if every mempool check fails.
 */
const SUBTRACT_MS = 60 * 60 * 1000;
export function pendingSpentRaw(
  asset: string,
  address?: string | null,
  excludeTxids: ReadonlySet<string> = new Set(),
): bigint {
  const now = Date.now();
  return sumRaw(
    readPending()
      .filter(
        (i) =>
          !i.resolved &&
          !excludeTxids.has(i.txid) &&
          (!i.address || !address || i.address === address) &&
          now - i.addedAt < SUBTRACT_MS,
      )
      .flatMap((i) =>
        i.spends?.length
          ? i.spends.filter((spend) => spend.asset === asset).map((spend) => spend.raw)
          : i.giveAsset === asset
            ? [i.giveRaw ?? 0]
            : [],
      ),
  );
}

export function subscribePending(cb: () => void): () => void {
  const onStorage = () => {
    // Another tab wrote — drop the cache so the next read reloads.
    cache = null;
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
