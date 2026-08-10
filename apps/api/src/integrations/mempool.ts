/**
 * Bitcoin-side transaction facts — fee and weight — from mempool.space.
 * Server-side only, and called once per transaction, ever: this is the
 * infrastructure a per-visitor client fetch would have duplicated across
 * every browser that opened the mempool tab.
 */
export async function fetchTxFee(
  txHash: string,
): Promise<{ feeSats: number; weightWu: number } | null> {
  try {
    const res = await fetch(`https://mempool.space/api/tx/${txHash}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const tx = (await res.json()) as { fee?: number; weight?: number };
    if (typeof tx.fee !== "number" || typeof tx.weight !== "number") return null;
    return { feeSats: tx.fee, weightWu: tx.weight };
  } catch {
    return null;
  }
}
