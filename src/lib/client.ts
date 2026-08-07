"use client";

import { parseJsonLossless, type Raw, sumRaw } from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Shared client-side API helpers. Before this file, fetchJson and
 * fetchBalance were copy-pasted into six components; keep the copies dead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Not res.json(): JSON.parse rounds any integer above 2^53-1 while parsing.
  // Oversized integers arrive as strings with every digit intact; anything in
  // the safe range keeps its shape, so consumers that were already correct are
  // untouched. Consumers that read a quantity should type the field as Raw —
  // the union is what makes the compiler point at a `+` that would narrow it.
  return parseJsonLossless(await res.text());
}

/**
 * An address's SPENDABLE balance for one asset, in raw units. UTXO-attached
 * rows are excluded: orders, mints, and pool deposits spend address balance
 * only (and composes pass exclude_utxos_with_balances), so counting
 * attached XCP would show funds the forms can't actually use.
 *
 * Exact, and a bigint rather than a number, because a balance is the source of
 * three things that must not drift: what the Max button fills in, what the
 * insufficient-funds check compares against, and — through those — what gets
 * signed. Holding the whole supply of a 100M-token XCP-69 asset is 10^16 raw,
 * already past where a double picks out a single integer, and the Holders tab
 * shows legacy assets an order of magnitude larger again.
 *
 * The `+` accumulator it replaces was the other half of the problem: a total
 * can leave the safe range even when every row it sums is comfortably inside.
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
