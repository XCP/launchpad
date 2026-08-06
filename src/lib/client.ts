"use client";

import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Shared client-side API helpers. Before this file, fetchJson and
 * fetchBalance were copy-pasted into six components; keep the copies dead.
 */
export async function fetchJson(url: string, timeoutMs = 10_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * An address's SPENDABLE balance for one asset, in raw units. UTXO-attached
 * rows are excluded: orders, mints, and pool deposits spend address balance
 * only (and composes pass exclude_utxos_with_balances), so counting
 * attached XCP would show funds the forms can't actually use.
 */
export async function fetchBalance(
  address: string,
  asset: string,
): Promise<number> {
  const data = await fetchJson(
    `${COUNTERPARTY_API_BASE}/addresses/${address}/balances/${asset}`,
  );
  const rows: { quantity: number; utxo?: string | null }[] = Array.isArray(
    data.result,
  )
    ? data.result
    : data.result
      ? [data.result]
      : [];
  return rows
    .filter((r) => !r.utxo)
    .reduce((s, r) => s + (r.quantity ?? 0), 0);
}
