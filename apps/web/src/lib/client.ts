"use client";

import {
  parseJsonLossless,
  type Raw,
  sumRaw,
  toBigInt,
} from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { relayingFetch } from "@/lib/counterparty-relay";

/**
 * Shared client-side API helpers. Before this file, fetchJson and
 * fetchBalance were copy-pasted into six components; keep the copies dead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<any> {
  // relayingFetch is a no-op for anything that is not Counterparty, so this
  // stays the plain shared reader it has always been for every other host.
  const res = await relayingFetch(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Not res.json(): JSON.parse rounds integers above 2^53-1. Oversized
  // integers arrive as strings (type quantity fields as Raw); safe-range
  // values keep their shape.
  return parseJsonLossless(await res.text());
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
