import { XCP_API_BASE } from "@/lib/constants";

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
    if (!res.ok) throw new Error(`xcp.io ledger ${res.status}`);
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
