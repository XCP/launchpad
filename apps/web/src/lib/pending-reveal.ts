/**
 * The half of an inscription launch that is not on-chain yet.
 *
 * An inscription launch is two transactions: the commit pays into a Taproot
 * output that commits to the envelope, and the reveal spends it through the
 * envelope leaf. Only the reveal makes the launch. Once the commit is
 * broadcast, its BTC can leave that output only through a reveal, and
 * rebuilding one needs the exact envelope, so if the wallet prompt is
 * cancelled or the page dies in between, the funds are stuck unless the
 * envelope was kept somewhere.
 *
 * This keeps it: written right before the commit is broadcast, removed once
 * the reveal is. Per address, in this browser's localStorage. Nothing here is
 * secret; it is all on-chain the moment the reveal is.
 */
import { useMemo, useSyncExternalStore } from "react";
import { Address } from "@scure/btc-signer";

const KEY_PREFIX = "xcp.fun:pending-reveal:";
/** Same-tab change notice; other tabs hear the `storage` event. */
const CHANGED = "xcp.fun:pending-reveal-changed";

export interface PendingReveal {
  version: 1;
  /** The launch's source: funded the commit, signs the reveal. */
  address: string;
  asset: string;
  startBlock: number;
  /** Hex: the envelope leaf's script and the commit output's internal key. */
  revealScript: string;
  tapInternalKey: string;
  commitTxid: string;
  commitVout: number;
  commitAmount: number;
  /** The signed commit, so it can be broadcast again if it never reached the network. */
  commitRawTx: string;
  /** Where the inscription goes: the burn address. */
  recipient: string;
  feeRate: number;
  /** Signed reveal, when the wallet signed both at once; resuming only broadcasts it. */
  revealRawTx?: string;
  createdAt: number;
}

const HEX = /^(?:[0-9a-f]{2})+$/;
const TXID = /^[0-9a-f]{64}$/;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** A record read back from storage, or null when it is not a complete one for `address`. */
export function parsePendingReveal(raw: unknown, address: string): PendingReveal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  if (
    r.version !== 1 ||
    r.address !== address ||
    typeof r.asset !== "string" || !r.asset ||
    !positive(r.startBlock) ||
    typeof r.revealScript !== "string" || !HEX.test(r.revealScript) ||
    typeof r.tapInternalKey !== "string" || !/^[0-9a-f]{64}$/.test(r.tapInternalKey) ||
    typeof r.commitTxid !== "string" || !TXID.test(r.commitTxid) ||
    typeof r.commitVout !== "number" || !Number.isSafeInteger(r.commitVout) || r.commitVout < 0 ||
    !positive(r.commitAmount) ||
    typeof r.commitRawTx !== "string" || !HEX.test(r.commitRawTx) ||
    typeof r.recipient !== "string" ||
    typeof r.feeRate !== "number" || !Number.isFinite(r.feeRate) || r.feeRate <= 0 ||
    (r.revealRawTx !== undefined && (typeof r.revealRawTx !== "string" || !HEX.test(r.revealRawTx))) ||
    typeof r.createdAt !== "number"
  ) {
    return null;
  }
  try {
    Address().decode(r.recipient);
  } catch {
    return null;
  }
  return r as unknown as PendingReveal;
}

function readRaw(address: string): string | null {
  try {
    return storage()?.getItem(KEY_PREFIX + address) ?? null;
  } catch {
    return null;
  }
}

function parseRaw(raw: string | null, address: string): PendingReveal | null {
  if (!raw) return null;
  try {
    return parsePendingReveal(JSON.parse(raw), address);
  } catch {
    return null;
  }
}

export function loadPendingReveal(address: string): PendingReveal | null {
  return parseRaw(readRaw(address), address);
}

function announce(): void {
  try {
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // No window (a test or the server): nobody is listening.
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The kept reveal for `address`, live: it appears when a commit goes out alone and goes when the reveal does. */
export function usePendingReveal(address: string | null | undefined): PendingReveal | null {
  const raw = useSyncExternalStore(subscribe, () => (address ? readRaw(address) : null), () => null);
  return useMemo(() => (address ? parseRaw(raw, address) : null), [raw, address]);
}

/** Throws when it cannot be kept: broadcasting a commit whose reveal could be lost is the thing this prevents. */
export function savePendingReveal(record: PendingReveal): void {
  const store = storage();
  if (!store) throw new Error("This browser cannot keep the launch's reveal data, so the commit was not broadcast");
  store.setItem(KEY_PREFIX + record.address, JSON.stringify(record));
  if (!loadPendingReveal(record.address)) {
    throw new Error("This browser did not keep the launch's reveal data, so the commit was not broadcast");
  }
  announce();
}

export function clearPendingReveal(address: string): void {
  try {
    storage()?.removeItem(KEY_PREFIX + address);
  } catch {
    // Nothing to do: a record that cannot be removed is found spent on resume.
  }
  announce();
}
