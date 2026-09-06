/**
 * The explorer (api.xcp.io) is the ecosystem's own index and answers what
 * Counterparty's node cannot: which curated collections an address created
 * cards in, and which it holds cards of. Fifty addresses a call.
 */

const BASE = "https://api.xcp.io/v2";
export const ADDRESS_BATCH = 50;

export interface ExplorerAddressCollections {
  address: string;
  collections: { tag: string; cards: number }[];
  held?: { tag: string; cards: number }[];
}

export async function fetchAddressCollections(
  addresses: string[],
): Promise<ExplorerAddressCollections[]> {
  if (addresses.length === 0) return [];
  if (addresses.length > ADDRESS_BATCH) throw new Error(`explorer: at most ${ADDRESS_BATCH} addresses a call`);
  const query = addresses.map(encodeURIComponent).join(",");
  const res = await fetch(`${BASE}/addresses/collections?addresses=${query}&include=held`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`explorer /addresses/collections -> HTTP ${res.status}`);
  const data = (await res.json()) as { result?: ExplorerAddressCollections[] };
  return data.result ?? [];
}
