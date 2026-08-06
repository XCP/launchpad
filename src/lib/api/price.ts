import { XCP_API_BASE } from "@/utils/constants";

/**
 * XCP/USD from the explorer's aggregate feed (daily CMC aggregate; also
 * carries BTC). Purely decorative context — never used in any on-chain
 * math — so a null on failure just hides the dollar hints.
 */
export async function fetchXcpUsd(): Promise<number | null> {
  try {
    const res = await fetch(`${XCP_API_BASE}/price`, {
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const usd = (await res.json())?.result?.xcp?.usd;
    return typeof usd === "number" && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

/** BTC/USD from the same feed (same fetch — Next dedupes by URL). */
export async function fetchBtcUsd(): Promise<number | null> {
  try {
    const res = await fetch(`${XCP_API_BASE}/price`, {
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const usd = (await res.json())?.result?.btc?.usd;
    return typeof usd === "number" && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}
