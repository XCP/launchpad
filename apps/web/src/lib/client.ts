"use client";

import {
  parseJsonLossless,
  type Raw,
  sumRaw,
  toBigInt,
} from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/**
 * Shared client-side API helpers. Before this file, fetchJson and
 * fetchBalance were copy-pasted into six components; keep the copies dead.
 */
/**
 * Where a Counterparty read goes when the node will not talk to this browser,
 * and null for any other URL. See app/api/cp/[...path]/route.ts for why the
 * relay is same-origin and why it is second rather than first.
 */
function counterpartyRelay(url: string): string | null {
  if (!url.startsWith(COUNTERPARTY_API_BASE)) return null;
  try {
    const parsed = new URL(url);
    return `/api/cp${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether asking again, from somewhere else, could plausibly answer.
 *
 * A thrown TypeError is the important case and the reason this exists: it is
 * what a browser reports for a response it will not expose, which is what a
 * Cloud Armor denial without CORS headers looks like from script. There is no
 * status to read, so "the network died" and "you are being rate limited" are
 * the same event here — and only one of them is worth a retry, so both get one.
 *
 * 403, 429 and 5xx are worth relaying because they are about this caller or
 * this moment. A 404 or a 400 is about the request, and asking a second time
 * from a different address gets the same answer a little later.
 */
function worthRelaying(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 || [403, 429].includes(error.status);
  return true;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(url: string, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status);
  // Not res.json(): JSON.parse rounds integers above 2^53-1. Oversized
  // integers arrive as strings (type quantity fields as Raw); safe-range
  // values keep their shape.
  return parseJsonLossless(await res.text());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<any> {
  try {
    return await readJson(url, timeoutMs);
  } catch (error) {
    const relay = counterpartyRelay(url);
    if (!relay || !worthRelaying(error)) throw error;
    return readJson(relay, timeoutMs);
  }
}

/**
 * Spendable balance (UTXO-attached rows excluded) as an exact bigint: it
 * feeds Max, the insufficiency check, and through them the signed quantity.
 * A full XCP-69 bag is 10^16 raw (past 2^53), and a summed total can leave
 * the safe range even when every row is inside it.
 */
export async function fetchBalance(
  address: string,
  asset: string,
): Promise<bigint> {
  const data = await fetchJson(
    `${COUNTERPARTY_API_BASE}/addresses/${encodeURIComponent(address)}/balances/${encodeURIComponent(asset)}?type=address`,
  );
  const rows: { quantity: Raw; utxo?: string | null }[] = Array.isArray(
    data.result,
  )
    ? data.result
    : data.result
      ? [data.result]
      : [];
  return sumRaw(rows.filter((r) => !r.utxo).map((r) => r.quantity));
}

export interface PendingAssetDebit {
  quantity: bigint;
  txids: Set<string>;
}

interface MempoolLedgerEvent {
  tx_hash?: string;
  event?: string;
  params?: {
    address?: string;
    asset?: string;
    quantity?: Raw;
  };
}

/**
 * Counterparty debits already parsed from the node's mempool, grouped by
 * asset. The endpoint's address match is a superset, so every event is
 * filtered against its own exact address before it can affect a balance.
 */
export async function fetchPendingDebits(
  address: string,
): Promise<Map<string, PendingAssetDebit>> {
  const query = new URLSearchParams({
    addresses: address,
    event_name: "DEBIT",
    verbose: "true",
    limit: "100",
  });
  const data = await fetchJson(
    `${COUNTERPARTY_API_BASE}/addresses/mempool?${query.toString()}`,
  );
  const events: MempoolLedgerEvent[] = Array.isArray(data.result)
    ? data.result
    : [];
  const byAsset = new Map<string, PendingAssetDebit>();

  for (const event of events) {
    const params = event.params;
    if (
      event.event !== "DEBIT" ||
      !event.tx_hash ||
      params?.address !== address ||
      !params.asset
    ) {
      continue;
    }
    const quantity = toBigInt(params.quantity);
    if (quantity === null) {
      throw new Error("Counterparty returned an unreadable pending debit");
    }
    const current = byAsset.get(params.asset) ?? {
      quantity: 0n,
      txids: new Set<string>(),
    };
    current.quantity += quantity;
    current.txids.add(event.tx_hash);
    byAsset.set(params.asset, current);
  }

  return byAsset;
}
