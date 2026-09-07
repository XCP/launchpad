import { describe, expect, it } from "vitest";
import { COUNTERPARTY_MAX_INT } from "@xcp/wallet-sdk/amounts";
import { deriveLimitAmounts } from "../apps/web/src/lib/limit-amounts";
import { parseWholeTokenRaw } from "../apps/web/src/lib/amount-draft";

describe("limit price guarantees", () => {
  for (const side of ["buy", "sell"] as const) {
    for (const edited of ["amount", "total"] as const) {
      it(`${side}, editing ${edited}: keeps the entered leg and never weakens the price`, () => {
        for (const price of [1n, 33333333n, 100000001n, 999999999n]) {
          for (const value of [100000001n, 999999999n, 10000000000000001n]) {
            if (edited === "total" && value * 100000000n / price > COUNTERPARTY_MAX_INT) continue;
            const result = deriveLimitAmounts(side, edited, value, price)!;
            expect(result[edited]).toBe(value);
            const actual = result.total * 100000000n;
            const limit = result.amount * price;
            expect(side === "buy" ? actual <= limit : actual >= limit).toBe(true);
          }
        }
      });
    }
  }
  it("rejects zero legs and overflow after derivation", () => {
    expect(deriveLimitAmounts("buy", "amount", 1n, 1n)).toBeNull();
    expect(deriveLimitAmounts("sell", "amount", COUNTERPARTY_MAX_INT, 200000000n)).toBeNull();
    expect(deriveLimitAmounts("buy", "total", COUNTERPARTY_MAX_INT, 1n)).toBeNull();
  });
  it("requires whole XCP lots before scaling, without truncating fractions", () => {
    expect(parseWholeTokenRaw("0.5")).toBeNull();
    expect(parseWholeTokenRaw("1e5")).toBeNull();
    expect(parseWholeTokenRaw("100")).toBe(10000000000n);
    expect(parseWholeTokenRaw("92233720369")).toBeNull();
  });
});
