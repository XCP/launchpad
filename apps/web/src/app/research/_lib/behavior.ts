import type { MempoolOrder } from "@launchpad/xcp69/mempool";
import { big } from "@/lib/numeric";

export interface PendingPressure {
  sellTransactions: number;
  sellWallets: number;
  sellQuantity: bigint;
  buyTransactions: number;
  buyWallets: number;
}

/** Pending XCP-pair intent per asset. A token-give/XCP-get order is a sell;
 * XCP-give/token-get is a buy. Transactions and wallets are both retained so
 * twenty queued dumps from one address never masquerade as twenty people. */
export function pendingPressureByAsset(
  orders: MempoolOrder[],
): Map<string, PendingPressure> {
  const rows = new Map<
    string,
    PendingPressure & { sellAddresses: Set<string>; buyAddresses: Set<string> }
  >();
  for (const order of orders) {
    const selling = order.giveAsset === order.asset && order.getAsset === "XCP";
    const buying = order.giveAsset === "XCP" && order.getAsset === order.asset;
    if (!selling && !buying) continue;
    let row = rows.get(order.asset);
    if (!row) {
      row = {
        sellTransactions: 0,
        sellWallets: 0,
        sellQuantity: 0n,
        buyTransactions: 0,
        buyWallets: 0,
        sellAddresses: new Set(),
        buyAddresses: new Set(),
      };
      rows.set(order.asset, row);
    }
    if (selling) {
      row.sellTransactions += 1;
      row.sellQuantity += big(order.giveQuantity);
      row.sellAddresses.add(order.source);
    }
    if (buying) {
      row.buyTransactions += 1;
      row.buyAddresses.add(order.source);
    }
  }
  return new Map(
    [...rows].map(([asset, row]) => [
      asset,
      {
        sellTransactions: row.sellTransactions,
        sellWallets: row.sellAddresses.size,
        sellQuantity: row.sellQuantity,
        buyTransactions: row.buyTransactions,
        buyWallets: row.buyAddresses.size,
      },
    ]),
  );
}
