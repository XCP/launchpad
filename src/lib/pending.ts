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

export type PendingKind = "order" | "dispense" | "mint" | "pool";

export interface PendingItem {
  txid: string;
  kind: PendingKind;
  label: string;
  addedAt: number;
  /** Resolved state, set by the dock's poller. */
  resolved?: string;
  /** What this action spends, for optimistic balance display. */
  giveAsset?: string;
  giveRaw?: number;
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
  write(readPending().map((i) => (i.txid === txid ? { ...i, ...patch } : i)));
}

export function dismissPending(txid: string) {
  write(readPending().filter((i) => i.txid !== txid));
}

/** Raw units of `asset` spent by still-unresolved pending actions. */
export function pendingSpentRaw(asset: string): number {
  return readPending()
    .filter((i) => !i.resolved && i.giveAsset === asset)
    .reduce((s, i) => s + (i.giveRaw ?? 0), 0);
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
