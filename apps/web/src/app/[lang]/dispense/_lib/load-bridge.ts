import { fetchXcpDispensers } from "@/lib/api/counterparty";
import { fetchMarketPrices } from "@/lib/api/price";

/** An unavailable book is not evidence that there are no open dispensers. */
export async function loadXcpBridge() {
  const [dispensers, prices] = await Promise.all([
    fetchXcpDispensers().catch(() => null),
    // One ticker supplies both fiat values. Its simultaneous dispenser read
    // shares the existing Counterparty helper's in-flight request above.
    fetchMarketPrices().catch(() => null),
  ]);
  return { dispensers, btcUsd: prices?.btc ?? null, xcpUsd: prices?.xcp ?? null };
}
