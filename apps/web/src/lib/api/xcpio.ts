const XCPIO_API = "https://api.xcp.io/v2";

/**
 * The explorer's own live holder count — distinct from our `participants`
 * stat, which only ever counts addresses that minted and never updates as
 * tokens change hands afterward. Decorative: a fetch failure just hides
 * the fact rather than blocking the page.
 */
export async function fetchHolderCount(asset: string): Promise<number | null> {
  try {
    const res = await fetch(`${XCPIO_API}/assets/${encodeURIComponent(asset)}`, {
      // Decorative, and the catch below returns null -- but a stall never
      // reaches a catch, it just holds the render open.
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const count = (await res.json())?.result?.holder_count;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}
