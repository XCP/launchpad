"use client";

import { fetchAssetTradesPage, type AssetTradePage, type ActivityTrade } from "@/lib/api/launchpad-api";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_READ_API_BASE } from "@/lib/constants";
import { mergePairTrades, type MatchRow, type PairTrade } from "@launchpad/xcp69/trades";

type KnownTrade = Pick<PairTrade, "txHash" | "address" | "buy" | "tokenQuantity" | "xcpQuantity">;
export const tradeFingerprint = (trade: KnownTrade) => JSON.stringify([
  trade.txHash, trade.address, trade.buy, trade.tokenQuantity, trade.xcpQuantity,
]);

/** Once fallback is needed, keep a complete Core snapshot for this table's
 * pagination session. Refresh on page one; later pages use the same snapshot
 * even if the index catches up or a new block arrives in the meantime. */
export function createTradeHistoryReader(asset: string, divisible: boolean) {
  let usingCore = false;
  let snapshot: Promise<ActivityTrade[]> | null = null;
  return async (limit: number, offset: number, knownLatestBlock = 0, knownHead: string[] = []): Promise<AssetTradePage> => {
    if (!usingCore) {
      const indexed = await fetchAssetTradesPage(asset, limit, offset);
      const head = indexed && indexed.total > 0 && offset > 0 && knownLatestBlock > 0
        ? await fetchAssetTradesPage(asset, Math.max(limit, knownHead.length), 0) : indexed;
      const available = new Map<string, number>();
      for (const trade of head?.result ?? []) {
        const key = tradeFingerprint({ txHash: trade.txHash ?? "", address: trade.address, buy: trade.side === "buy",
          tokenQuantity: String(trade.tokenDelta).replace(/^-/, ""), xcpQuantity: String(trade.xcpDelta).replace(/^-/, "") });
        available.set(key, (available.get(key) ?? 0) + 1);
      }
      const containsKnown = knownHead.every(key => {
        const count = available.get(key) ?? 0;
        available.set(key, count - 1);
        return count > 0;
      });
      if (indexed && indexed.total > 0 && head && containsKnown
        && Math.max(0, ...head.result.map(t => t.block)) >= knownLatestBlock) return indexed;
      usingCore = true;
    }
    if (!snapshot || offset === 0) snapshot = readCoreHistory(asset, divisible);
    const pending = snapshot;
    let trades: ActivityTrade[];
    try { trades = await pending; }
    catch (error) { if (snapshot === pending) snapshot = null; throw error; }
    return {
      result: trades.slice(offset, offset + limit), total: trades.length,
      nextOffset: offset + limit < trades.length ? offset + limit : null,
    };
  };
}

async function readCoreHistory(asset: string, divisible: boolean): Promise<ActivityTrade[]> {
  const pair = `${encodeURIComponent(asset)}/XCP`;
  async function walk(path: string): Promise<MatchRow[]> {
    const rows: MatchRow[] = [];
    let cursor: number | null = null;
    const seen = new Set<number>();
    for (let page = 0; page < 200; page++) {
      const data = await fetchJson(`${COUNTERPARTY_READ_API_BASE}${path}&limit=500${cursor === null ? "" : `&cursor=${cursor}`}`);
      if (!Array.isArray(data.result)) throw new Error("trade_history_invalid");
      rows.push(...data.result);
      if (data.next_cursor === null) return rows;
      if (!Number.isSafeInteger(data.next_cursor) || seen.has(data.next_cursor)) throw new Error("trade_history_incomplete");
      cursor = data.next_cursor;
      seen.add(cursor!);
    }
    throw new Error("trade_history_incomplete");
  }
  const [pool, book] = await Promise.all([
    walk(`/pools/${pair}/matches?verbose=true`),
    walk(`/orders/${pair}/matches?verbose=true&status=completed`),
  ]);
  const trades = await mergePairTrades(asset, pool, book,
    async txHash => (await fetchJson(`${COUNTERPARTY_READ_API_BASE}/transactions/${encodeURIComponent(txHash)}/events?limit=1000`)).result);
  return trades.map(trade => ({
      key: trade.key, txHash: trade.txHash, asset,
      address: trade.address, counterpartyAddress: trade.counterpartyAddress || null,
      block: trade.block, tokenDelta: `${trade.buy ? "" : "-"}${trade.tokenQuantity}`,
      xcpDelta: `${trade.buy ? "-" : ""}${trade.xcpQuantity}`,
      side: trade.buy ? "buy" : "sell", venue: trade.venue,
      divisible,
    }));
}
