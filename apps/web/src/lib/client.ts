"use client";

import { parseJsonLossless, type Raw, sumRaw } from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/**
 * Shared client-side API helpers. Before this file, fetchJson and
 * fetchBalance were copy-pasted into six components; keep the copies dead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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
    `${COUNTERPARTY_API_BASE}/addresses/${address}/balances/${asset}`,
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
