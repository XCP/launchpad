"use client";

import { approx, parseJsonLossless, type Raw, sumRaw } from "@/lib/numeric";
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
 * The rows are summed as exact integers — a `+` accumulator is the classic
 * way a total drifts past what its parts justify, and an address can hold
 * enough of a large-supply asset for it to matter. The number returned is the
 * correctly-rounded double of that exact total, which is what the forms need:
 * they divide it by 1e8 for display and take percentages of it for the preset
 * buttons, both approximations by nature. What must never be approximate is a
 * quantity on its way into a transaction, and that is gated separately in
 * useCompose.
 */
export async function fetchBalance(
  address: string,
  asset: string,
): Promise<number> {
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
  return approx(sumRaw(rows.filter((r) => !r.utxo).map((r) => r.quantity)));
}
