import { COUNTERPARTY_MAX_INT } from "@xcp/wallet-sdk/amounts";

const UNIT = 100_000_000n;
const ceilDivide = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Quantize the derived leg without weakening the user's limit price. */
export function deriveLimitAmounts(side: "buy" | "sell", edited: "amount" | "total", value: bigint, price: bigint) {
  if (value <= 0n || price <= 0n) return null;
  const amount = edited === "amount" ? value
    : side === "buy" ? ceilDivide(value * UNIT, price) : value * UNIT / price;
  const total = edited === "total" ? value
    : side === "sell" ? ceilDivide(value * price, UNIT) : value * price / UNIT;
  if (amount <= 0n || total <= 0n || amount > COUNTERPARTY_MAX_INT || total > COUNTERPARTY_MAX_INT) return null;
  return { amount, total };
}
