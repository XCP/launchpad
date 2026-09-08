import { COUNTERPARTY_READ_API_BASE } from "@/lib/constants";

type NodeRequestInit = RequestInit & { next?: { revalidate?: number } };

/** Lossless read-only fallback for fields absent from the indexed APIs.
 * Wallet operations use the authoritative node directly. Keep Next's patched
 * fetch in this path: next.revalidate caches immutable creation events for a
 * year and other reads for their existing windows. A binding.fetch(Request)
 * bypasses that data cache and drops the Next-specific request options. */
export async function nodeApiFetch(path: string, init: NodeRequestInit = {}): Promise<Response> {
  const url = `${COUNTERPARTY_READ_API_BASE}${path}`;
  return fetch(url, init);
}
