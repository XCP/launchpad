"use client";

/**
 * The pending registry: broadcast-but-unresolved actions, persisted in
 * localStorage so they survive navigation and reloads. With ten-minute
 * blocks, leaving the page mid-wait is rational — the dock keeps the
 * truth in view wherever the user goes.
 */

export type PendingKind = "order" | "dispense" | "mint" | "pool";

export interface PendingItem {
  txid: string;
  kind: PendingKind;
  label: string;
  addedAt: number;
  /** Resolved state, set by the dock's poller. */
  resolved?: string;
}

const KEY = "xcpfun:pending:v1";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const EVENT = "xcpfun:pending-updated";

export function readPending(): PendingItem[] {
  if (typeof window === "undefined") return [];
  try {
    const items: PendingItem[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return items.filter((i) => Date.now() - i.addedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function write(items: PendingItem[]) {
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

export function subscribePending(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
