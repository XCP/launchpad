export type MatchRow = Record<string, unknown>;

export interface CounterpartyEvent {
  event_index?: number;
  event?: string;
  params?: Record<string, unknown>;
}

export interface PairTrade {
  key: string;
  block: number;
  time: number;
  /** Counterparty's global transaction order within and across blocks. */
  txIndex: number;
  /** Exact message order inside a transaction, when that transaction filled more than once. */
  eventIndex: number;
  buy: boolean;
  tokenQuantity: string;
  xcpQuantity: string;
  address: string;
  venue: "pool" | "book";
  txHash: string;
  /** Counterparty's unique order-match id; empty for pool fills. */
  matchId: string;
  /** Resting maker on a book fill; empty for pool fills. */
  counterpartyAddress: string;
  /** Stable source-list order, used only when event enrichment is unavailable. */
  sourceOrder: number;
}

interface WorkingTrade extends PairTrade {
  forwardAsset: string;
  backwardAsset: string;
  forwardQuantity: string;
  backwardQuantity: string;
}

const MAX_EVENT_LOOKUPS = 8;

function finiteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function shape(
  asset: string,
  row: MatchRow,
  venue: "pool" | "book",
  ordinal: number,
): WorkingTrade | null {
  const forwardAsset = text(row.forward_asset);
  const backwardAsset = text(row.backward_asset);
  if (
    !(
      (forwardAsset === asset && backwardAsset === "XCP") ||
      (forwardAsset === "XCP" && backwardAsset === asset)
    )
  ) {
    return null;
  }

  const forwardQuantity = text(row.forward_quantity);
  const backwardQuantity = text(row.backward_quantity);
  const forwardIsToken = forwardAsset === asset;
  const txHash = text(venue === "pool" ? row.tx_hash : row.tx1_hash);
  if (!txHash || !forwardQuantity || !backwardQuantity) return null;

  const matchId = text(row.id);
  return {
    // Replaced below after enrichment. The ordinal makes the fallback unique
    // even when one pool transaction creates two otherwise identical fills.
    key: `${venue}-${txHash}-${matchId || `${forwardQuantity}-${backwardQuantity}`}-${ordinal}`,
    block: finiteNumber(row.block_index),
    time: finiteNumber(row.block_time),
    txIndex: finiteNumber(venue === "pool" ? row.tx_index : row.tx1_index),
    eventIndex: 0,
    buy: forwardIsToken,
    tokenQuantity: forwardIsToken ? forwardQuantity : backwardQuantity,
    xcpQuantity: forwardIsToken ? backwardQuantity : forwardQuantity,
    address: text(venue === "pool" ? row.source : row.tx1_address),
    venue,
    txHash,
    matchId,
    counterpartyAddress: text(venue === "book" ? row.tx0_address : ""),
    sourceOrder: ordinal,
    forwardAsset,
    backwardAsset,
    forwardQuantity,
    backwardQuantity,
  };
}

function eventMatches(trade: WorkingTrade, event: CounterpartyEvent): boolean {
  if (event.event !== (trade.venue === "pool" ? "POOL_MATCH" : "ORDER_MATCH")) {
    return false;
  }
  const p = event.params ?? {};
  if (trade.venue === "book" && trade.matchId && text(p.id) === trade.matchId) {
    return true;
  }

  const eventTxHash = text(
    trade.venue === "pool" ? p.tx_hash : p.tx1_hash,
  );
  return (
    eventTxHash === trade.txHash &&
    text(p.forward_asset) === trade.forwardAsset &&
    text(p.backward_asset) === trade.backwardAsset &&
    text(p.forward_quantity) === trade.forwardQuantity &&
    text(p.backward_quantity) === trade.backwardQuantity
  );
}

/**
 * Merge pool and order-book matches into one exact Counterparty chronology.
 *
 * Match endpoints expose a block and transaction index, but not the event
 * index. That is sufficient except when a single transaction crosses several
 * venues or price levels. We enrich only those ambiguous transactions from
 * their immutable event list; the common one-fill case costs no extra fetch.
 */
export async function mergePairTrades(
  asset: string,
  poolRows: MatchRow[],
  bookRows: MatchRow[],
  fetchEvents: (txHash: string) => Promise<CounterpartyEvent[]>,
): Promise<PairTrade[]> {
  const token = asset.toUpperCase();
  const rows = [
    ...poolRows
      .filter((row) => row.status === undefined || row.status === "valid")
      .map((row, i) => shape(token, row, "pool", i)),
    ...bookRows.map((row, i) => shape(token, row, "book", poolRows.length + i)),
  ].filter((row): row is WorkingTrade => row !== null);

  const byTransaction = new Map<string, WorkingTrade[]>();
  for (const row of rows) {
    const group = byTransaction.get(row.txHash) ?? [];
    group.push(row);
    byTransaction.set(row.txHash, group);
  }

  const ambiguous = [...byTransaction.entries()]
    .filter(([, group]) => group.length > 1)
    .slice(0, MAX_EVENT_LOOKUPS);
  await Promise.all(
    ambiguous.map(async ([txHash, group]) => {
      let events: CounterpartyEvent[] = [];
      try {
        events = await fetchEvents(txHash);
      } catch {
        // Keep a deterministic block/transaction fallback if an upstream node
        // briefly fails. The next refresh will attempt the immutable list again.
      }
      const unused = new Set(events.map((_, i) => i));
      for (const trade of group) {
        const eventPosition = events.findIndex(
          (event, i) => unused.has(i) && eventMatches(trade, event),
        );
        if (eventPosition < 0) continue;
        unused.delete(eventPosition);
        trade.eventIndex = finiteNumber(events[eventPosition]?.event_index);
        if (trade.eventIndex) trade.key = `event-${trade.eventIndex}`;
      }
    }),
  );

  return rows
    .sort(
      (a, b) =>
        b.block - a.block ||
        b.txIndex - a.txIndex ||
        b.eventIndex - a.eventIndex ||
        b.sourceOrder - a.sourceOrder,
    )
    .map(({ forwardAsset: _fa, backwardAsset: _ba, forwardQuantity: _fq, backwardQuantity: _bq, ...trade }) => trade);
}
