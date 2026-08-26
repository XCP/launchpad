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

/**
 * Raw token units this address has already minted from ONE launch, confirmed.
 *
 * Scoped by fairminter, not by ticker, and that is the whole reason this takes
 * three arguments. This endpoint answers for the TICKER, and a ticker is not
 * unique across fairminters: the owner of an UNLOCKED asset can open another
 * one under the same name (see migration 0016 in apps/api).
 *
 * A conforming launch cannot be the one that comes back — xcp69Params requires
 * lock_quantity, so its supply is locked and its failure is final. But an
 * earlier NON-conforming fairminter on the same ticker need not have locked
 * anything, and this address's mints against it would come back in the same
 * response. Subtracting those would lock someone out of a mint they are fully
 * entitled to, and a guard that blocks a legitimate mint is worse than the
 * wasted fee it was built to prevent.
 *
 * Only `valid` rows count, for the mirror-image reason: the endpoint returns
 * invalid fairmints too, and an address that has already tripped the cap has
 * one on file. Counting it would subtract an allowance that was never spent.
 *
 * Paginated to exhaustion. The cap is 1,000 lots and a mint can be a single
 * lot, so a thousand rows is reachable and a first page is not the universe.
 *
 * Pairs with the mempool half in the mint panel: this is what the ledger
 * knows, and the ledger is precisely what has not seen an unconfirmed mint.
 */
export async function fetchAddressFairmints(
  address: string,
  asset: string,
  fairminterTxHash: string,
): Promise<bigint> {
  const base = `${COUNTERPARTY_API_BASE}/addresses/${encodeURIComponent(address)}/fairmints/${encodeURIComponent(asset)}?limit=1000`;
  let cursor: string | number | null = null;
  let total = 0n;
  // Bounded so a cursor that never terminates cannot spin forever; 1,000 rows
  // a page is far past the 1,000-lot ceiling on a single address.
  for (let page = 0; page < 10; page++) {
    const url: string = cursor === null ? base : `${base}&cursor=${encodeURIComponent(cursor)}`;
    const data = await fetchJson(url);
    const rows: { earn_quantity?: Raw; status?: string; fairminter_tx_hash?: string }[] =
      Array.isArray(data.result) ? data.result : [];
    total += sumRaw(
      rows
        .filter((r) => r.status === "valid" && r.fairminter_tx_hash === fairminterTxHash)
        .map((r) => r.earn_quantity ?? ("0" as Raw)),
    );
    cursor = data.next_cursor ?? null;
    if (cursor === null) break;
  }
  return total;
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
