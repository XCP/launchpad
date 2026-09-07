import { ratio, toBigInt, type Raw } from "@/lib/numeric";

interface OrderRemaining {
  give_asset: string; get_asset: string;
  give_remaining: Raw; get_remaining: Raw;
}

/** Pair identity and divisibility are independent of direction and locale. */
export function xcpOrderRemaining(order: OrderRemaining, asset: string, divisible: boolean) {
  const isBuy = order.give_asset === "XCP" && order.get_asset === asset;
  const isSell = order.give_asset === asset && order.get_asset === "XCP";
  if (asset === "XCP" || (!isBuy && !isSell)) return null;
  const tokenRaw = toBigInt(isBuy ? order.get_remaining : order.give_remaining);
  const xcpRaw = toBigInt(isBuy ? order.give_remaining : order.get_remaining);
  if (tokenRaw === null || xcpRaw === null || tokenRaw < 0n || xcpRaw < 0n) return null;
  return { isBuy, tokenRaw, xcpRaw,
    price: ratio(xcpRaw * (divisible ? 100000000n : 1n), tokenRaw * 100000000n) };
}

export function orderAssetDecimals(asset: string, info?: { divisible?: boolean }): 0 | 8 | null {
  if (asset === "XCP" || asset === "BTC") return 8;
  return typeof info?.divisible === "boolean" ? info.divisible ? 8 : 0 : null;
}
