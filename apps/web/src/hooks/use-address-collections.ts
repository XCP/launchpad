import useSWR from "swr";
import { fetchAddressCollections } from "@/lib/api/explorer";

/**
 * Collection-creator badges for the addresses on screen — the page of
 * minters or holders, never the whole list — in one explorer call. Same
 * shape as useAddressFreshness: keyed by the visible addresses, so every
 * list showing the same page shares one request, and a failed lookup is
 * undefined (no badges), never a wrong answer.
 */
export function useAddressCollections(addresses: string[]): Map<string, string[]> | undefined {
  const key = [...new Set(addresses)].sort().join(",");
  return useSWR(key ? ["address-collections", key] : null, () => fetchAddressCollections(addresses), {
    revalidateOnFocus: false,
    dedupingInterval: 600_000,
  }).data;
}
