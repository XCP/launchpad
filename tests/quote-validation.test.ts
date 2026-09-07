import { describe, expect, it } from "vitest";
import { validateDepositQuote, validateWithdrawQuote, validateSwapQuote } from "../apps/web/src/lib/quote-validation";

const deposit = { first_deposit: false, asset_a: "XCP", asset_b: "TOKEN", quantity_a_required: "10000000000000001", quantity_b_required: "100", quantity_minted_estimate: "50" };
const withdraw = { pool_exists: true, asset_a: "XCP", asset_b: "TOKEN", quantity: "100", quantity_a_estimate: "10000000000000001", quantity_b_estimate: "50", supply: "200" };
describe("quote identity and exact numeric boundaries", () => {
  it("matches the edited URL leg even when Core sorts assets differently", () => {
    expect(validateDepositQuote(deposit, "TOKEN", "XCP", 100n)).toBe(deposit);
    expect(() => validateDepositQuote(deposit, "TOKEN", "XCP", 101n)).toThrow("quote_quantity_mismatch");
    expect(() => validateDepositQuote(deposit, "OTHER", "XCP", 100n)).toThrow("quote_asset_mismatch");
  });
  it.each(["0,5", "1e5", "-1", "1.5", Number.MAX_SAFE_INTEGER + 1, "9223372036854775808"])("rejects invalid raw values %s returned by an API", value => {
    expect(() => validateDepositQuote({ ...deposit, quantity_a_required: value }, "TOKEN", "XCP", 100n)).toThrow();
    expect(() => validateWithdrawQuote({ ...withdraw, quantity_a_estimate: value }, "TOKEN", "XCP", 100n)).toThrow();
    expect(() => validateSwapQuote({ estimated_output: value, price_impact: 0 })).toThrow();
  });
  it("checks LP quantity, pool existence, pair, and supply before withdrawals", () => {
    expect(validateWithdrawQuote(withdraw, "TOKEN", "XCP", 100n)).toBe(withdraw);
    expect(() => validateWithdrawQuote(withdraw, "TOKEN", "XCP", 101n)).toThrow();
    expect(() => validateWithdrawQuote({ ...withdraw, supply: "99" }, "TOKEN", "XCP", 100n)).toThrow();
    expect(() => validateWithdrawQuote({ ...withdraw, pool_exists: false }, "TOKEN", "XCP", 100n)).toThrow();
    expect(() => validateSwapQuote({ estimated_output: "100", price_impact: NaN })).toThrow();
  });
});
