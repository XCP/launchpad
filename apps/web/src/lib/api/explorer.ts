import { COUNTERPARTY_API_BASE, XCP_API_BASE } from "@/lib/constants";
import { fetchJson } from "@/lib/client";
import { discard } from "@/lib/net";
import { coalesceHolderBalances, type HolderRow, type LpBalance } from "@/lib/holders";
import type { Raw } from "@/lib/numeric";

interface ExplorerLedgerRow {
  direction: "in" | "out";
  block_index: number;
  tx_hash: string;
  asset: string;
  /** Raw quantity, preserved as text by the explorer index. */
  quantity: string;
  calling_function?: string | null;
}

interface LedgerPage {
  result?: ExplorerLedgerRow[];
  next_offset?: number | null;
}

export interface DatedBalanceMovement {
  asset: string;
  block: number;
  txHash: string;
  quantity: string;
  direction: 1 | -1;
  callingFunction: string | null;
}

export interface LedgerWindow {
  movements: DatedBalanceMovement[];
  /** False when the safety page cap was reached before the requested block. */
  complete: boolean;
}

/**
 * Every dated balance movement over a recent window, from xcp.io's indexed
 * Counterparty credit/debit ledger.
 *
 * This is a FALLBACK for wallets whose cheap xcp.fun mint/trade history does
 * not reconcile. Rows are newest-first, so we stop as soon as the requested
 * boundary appears rather than walking a busy address's lifetime. Five pages
 * (500 movements) is a hard resource bound; reaching it returns incomplete
 * and the caller keeps the chart hidden instead of drawing partial history.
 */
export async function fetchAddressLedgerSince(
  address: string,
  sinceBlock: number,
  maxPages = 5,
): Promise<LedgerWindow> {
  const movements: DatedBalanceMovement[] = [];
  let offset = 0;
  let pages = 0;
  let reachedBoundary = false;
  let nextOffset: number | null = 0;

  do {
    const res = await fetch(
      `${XCP_API_BASE}/addresses/${encodeURIComponent(address)}/ledger?limit=100&offset=${offset}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) {
      await discard(res);
      throw new Error(`xcp.io ledger ${res.status}`);
    }
    const page = (await res.json()) as LedgerPage;
    if (!Array.isArray(page.result)) throw new Error("xcp.io ledger malformed response");
    for (const row of page.result) {
      if (row.block_index <= sinceBlock) {
        reachedBoundary = true;
        continue;
      }
      movements.push({
        asset: row.asset,
        block: row.block_index,
        txHash: row.tx_hash,
        quantity: row.quantity,
        direction: row.direction === "in" ? 1 : -1,
        callingFunction: row.calling_function ?? null,
      });
    }
    nextOffset = page.next_offset ?? null;
    offset = nextOffset ?? offset;
    pages++;
  } while (nextOffset !== null && !reachedBoundary && pages < maxPages);

  return {
    movements: movements.sort((a, b) => a.block - b.block),
    complete: nextOffset === null || reachedBoundary,
  };
}

export interface AddressCollectionCreator {
  address: string;
  collections: { tag: string; cards: number }[];
}

/**
 * Which curated collections each address created cards in, by the
 * explorer's collection tag ("rare-pepe", "bitcorn", …). One call for a
 * whole page of rows; addresses that created nothing are simply absent. The
 * explorer projects this from every member asset's first issuance and
 * refreshes it with its daily collections crawl, so the answer follows the
 * collections as they grow. The list is sorted so the same page hits the
 * same edge-cache key whatever order the rows came in.
 */
export async function fetchAddressCollections(addresses: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(addresses)].sort().slice(0, 50);
  const out = new Map<string, string[]>();
  if (unique.length === 0) return out;
  const d = (await fetchJson(
    `${XCP_API_BASE}/addresses/collections?addresses=${unique.map(encodeURIComponent).join(",")}`,
  )) as { result?: AddressCollectionCreator[] };
  for (const row of d.result ?? []) {
    out.set(
      row.address,
      row.collections.map((c) => c.tag),
    );
  }
  return out;
}

interface ExplorerHolderRow {
  /** An address, or `txid:vout` for a UTXO-attached balance. */
  holder: string;
  quantity: Raw;
  role?: string | null;
}

/** The explorer serves at most 100 balances a page. */
const HOLDER_PAGE = 100;

/**
 * The largest balances first, one page. Counterparty's own endpoint pages the
 * whole holder set at 1,000 a request, which on a launch with ten thousand
 * holders was ten requests and three megabytes per view.
 */
export async function fetchTopHolders(asset: string, limit = HOLDER_PAGE): Promise<HolderRow[]> {
  const d = (await fetchJson(
    `${XCP_API_BASE}/assets/${encodeURIComponent(asset)}/balances?limit=${Math.min(limit, HOLDER_PAGE)}`,
  )) as { result?: ExplorerHolderRow[] };
  return coalesceHolderBalances(
    (d.result ?? []).map((row) =>
      row.holder.includes(":")
        ? { address: null, utxo: row.holder, quantity: row.quantity }
        : { address: row.holder, utxo: null, quantity: row.quantity },
    ),
  );
}

/** Every balance location of a small-supply token such as an LP token, one page. */
export async function fetchTopLpBalances(lpAsset: string): Promise<LpBalance[]> {
  const d = (await fetchJson(
    `${XCP_API_BASE}/assets/${encodeURIComponent(lpAsset)}/balances?limit=${HOLDER_PAGE}`,
  )) as { result?: ExplorerHolderRow[] };
  return (d.result ?? []).map((row) => ({
    address: row.holder.includes(":") ? null : row.holder,
    quantity: row.quantity,
  }));
}

/** The explorer's rolled-up holder count; null when it has no row for the asset yet. */
export async function fetchAssetHolderCount(asset: string): Promise<number | null> {
  try {
    const d = (await fetchJson(`${XCP_API_BASE}/assets/${encodeURIComponent(asset)}`)) as {
      result?: { holder_count?: unknown };
      holder_count?: unknown;
    };
    const count = d.result?.holder_count ?? d.holder_count;
    return typeof count === "number" ? count : typeof count === "string" && /^\d+$/.test(count) ? Number(count) : null;
  } catch {
    return null;
  }
}

/**
 * A fact that never changes once written, so the explorer answers first and
 * the node only covers what the explorer has not indexed yet (it can trail the
 * chain by hours).
 */
async function explorerFirst<Body, T>(
  path: string,
  pick: (body: Body) => T | null | undefined,
): Promise<T | null> {
  for (const base of [XCP_API_BASE, COUNTERPARTY_API_BASE]) {
    try {
      const value = pick((await fetchJson(`${base}${path}`)) as Body);
      if (value !== null && value !== undefined) return value;
    } catch {}
  }
  return null;
}

/** Unix seconds for a confirmed block. */
export function fetchBlockTimestamp(blockIndex: number): Promise<number | null> {
  return explorerFirst<{ result?: { block_time?: unknown } | null }, number>(
    `/blocks/${blockIndex}`,
    (body) => {
      const at = body.result?.block_time;
      return typeof at === "number" ? at : typeof at === "string" && /^[0-9]+$/.test(at) ? Number(at) : null;
    },
  );
}

/** The address that owns an asset today (its issuer when never transferred). */
export function fetchAssetOwner(asset: string): Promise<string | null> {
  return explorerFirst<{ result?: { owner?: string | null; issuer?: string | null } | null }, string>(
    `/assets/${encodeURIComponent(asset)}`,
    (body) => body.result?.owner ?? body.result?.issuer ?? null,
  );
}
