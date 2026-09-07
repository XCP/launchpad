// @vitest-environment happy-dom
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidatePending, pendingSpentRaw, readPending } from "@xcp/wallet-sdk";
import { SwapWidget } from "../apps/web/src/app/[lang]/swap/_components/swap-widget";
import { TradePanel } from "../apps/web/src/app/[lang]/[asset]/_components/trade-panel";
import { MintPanel } from "../apps/web/src/app/[lang]/[asset]/_components/mint-panel";
import { LiquidityWidget } from "../apps/web/src/app/[lang]/swap/_components/liquidity-widget";

const boundary = vi.hoisted(() => ({
  status: "idle", txid: null as string | null, address: "submitted-address",
  order: vi.fn(), deposit: vi.fn(), withdraw: vi.fn(), mint: vi.fn(), analytics: vi.fn(),
}));
vi.mock("@/lib/wallet/useCompose", () => ({ useCompose: () => ({
  status: boundary.status, txid: boundary.txid,
  composeOrder: boundary.order, composePoolDeposit: boundary.deposit,
  composeFairmint: boundary.mint,
  composePoolWithdraw: boundary.withdraw, composeCancel: vi.fn(), reset: vi.fn(),
}) }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => ({ address: boundary.address, status: "connected" }) }));
vi.mock("@xcp/wallet-sdk/react/use-spendable-balance", () => ({ useSpendableBalance: (_address: string, asset: string) => ({
  balance: asset === "LP" ? 40000000000000004n : 9000000000000000000n, pendingOutgoing: 0n,
}) }));
vi.mock("@/hooks/use-debounced", () => ({ useDebounced: (value: unknown) => value }));
vi.mock("@/hooks/use-mempool", () => ({ useMempool: () => ({ orders: [] }) }));
vi.mock("@/lib/currency", () => ({ useFiat: () => () => "$0", useFxRate: () => ({ code: "USD", rate: 1 }) }));
vi.mock("@/lib/analytics", () => ({ trackTx: boundary.analytics }));
vi.mock("@/app/[lang]/swap/_components/swap-settings", () => ({
  LIMIT_EXPIRATIONS: [100],
  useSwapSettings: () => ({ slippage: 1, slippageAuto: false, expiration: 100,
    limitExpiration: 100, lqSlippage: 1, customFee: 0.1, medianFeeRate: 1,
    swapSettingsValid: true, limitSettingsValid: true, liquiditySettingsValid: true,
    setAutoValue: () => {},
  }),
}));

function responseFor(key: unknown) {
  if (typeof key !== "string") return undefined;
  if (key.includes("estimatexcpfees")) return 5n;
  if (key.includes("/quote/deposit?")) return {
    first_deposit: false, asset_a: "TOKEN", asset_b: "XCP",
    quantity_a_required: new URL(key).searchParams.get("quantity"),
    quantity_b_required: "2000000001", quantity_minted_estimate: "300000000",
  };
  if (key.includes("/quote/withdraw?")) return {
    pool_exists: true, asset_a: "TOKEN", asset_b: "XCP",
    quantity: new URL(key).searchParams.get("quantity"), supply: "80000000000000008",
    quantity_a_estimate: "1000000001", quantity_b_estimate: "2000000001",
  };
  if (key.includes("/quote?")) return {
    estimated_output: "1000000001", pool_output: "1000000001", book_output: "0", price_impact: 0,
  };
  if (key.includes("/pools/")) return {
    asset_a: "TOKEN", asset_b: "XCP", lp_asset: "LP",
    reserve_a: "1000000000000000000", reserve_b: "1000000000000000000",
  };
  return undefined;
}
vi.mock("swr", () => ({ default: (key: unknown) => ({ data: responseFor(key), isValidating: false, mutate: vi.fn() }) }));
vi.mock("@/lib/client", () => ({ fetchJson: async (url: string) => ({ result: responseFor(url) }) }));
vi.mock("@/components/ui/button", () => ({ CTA: ({ children, ...props }: { children: ReactNode }) => <button data-testid="submit" {...props}>{children}</button> }));
vi.mock("@/components/asset-chip", () => ({ AssetChip: () => null }));
vi.mock("@/components/token-select-modal", () => ({ TokenSelectModal: () => null }));
vi.mock("@/components/order-tracker", () => ({ OrderTracker: () => null }));
vi.mock("@/components/connect-button", () => ({ ConnectButton: () => null }));
vi.mock("@/components/quote-ring", () => ({ QuoteRing: () => null }));

let root: Root;
let container: HTMLDivElement;
let view: ReactElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks();
  boundary.status = "idle"; boundary.txid = null; boundary.address = "submitted-address";
  localStorage.clear(); invalidatePending();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); });
async function render(element = view) { view = element; await act(() => root.render(element)); }
async function phase(status: string, txid: string | null = null) {
  boundary.status = status; boundary.txid = txid;
  // A fresh element rerenders the production component as the hook updates.
  await render(cloneElement(view));
}
async function enter(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input).not.toBeNull();
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
async function click(text?: string) {
  const button = text
    ? [...container.querySelectorAll("button")].find(b => b.textContent === text)!
    : container.querySelector<HTMLButtonElement>("[data-testid=submit]")!;
  expect(button).not.toBeNull(); expect(button.disabled).toBe(false);
  await act(async () => { button.click(); });
}
function expectReservation(asset: string, raw: bigint) {
  expect(pendingSpentRaw(asset, "submitted-address")).toBe(raw);
  expect(pendingSpentRaw(asset, "edited-address")).toBe(0n);
}

describe("confirmed pending spends use the submitted form, through edits while signing", () => {
  it("keeps a mint's original XCP cost, asset and account after an invalid edit", async () => {
    await render(<MintPanel asset="TOKEN" xcpUsd={2} />);
    await enter("TOKEN to mint", "1000"); await click();
    expect(boundary.mint).toHaveBeenCalledWith({ asset: "TOKEN", quantity: 100000000000 });
    await phase("signing"); await enter("TOKEN to mint", "-1000000");
    boundary.address = "edited-address";
    await render(<MintPanel asset="OTHER" xcpUsd={20} />);
    await phase("confirmed", "mint-tx");
    expectReservation("XCP", 1000000n);
    expect(readPending()[0]).toMatchObject({ label: "Mint 1,000 TOKEN" });
    expect(boundary.analytics).toHaveBeenCalledWith("mint-tx", "mint", 0.02);
  });

  it("keeps the swap amount/account/action and does not reuse it for a cancellation", async () => {
    await render(<SwapWidget assets={["TOKEN"]} xcpUsd={2} />);
    await enter("Amount of XCP to sell", "100000000.00000001");
    await click();
    expect(boundary.order).toHaveBeenCalledWith(expect.objectContaining({ give_quantity: 10000000000000001n }));
    await phase("signing");
    await enter("Amount of XCP to sell", "-5");
    boundary.address = "edited-address";
    await phase("confirmed", "swap-tx");
    expectReservation("XCP", 10000000000000001n);
    expect(readPending()[0]).toMatchObject({ address: "submitted-address", label: "Buy TOKEN — market order" });
    // USD is a display estimate; the reserved quantity above remains exact.
    expect(boundary.analytics).toHaveBeenCalledWith("swap-tx", "buy", 200000000);
    await enter("Amount of XCP to sell", "6");
    await phase("signing"); await phase("confirmed", "cancel-tx");
    expect(readPending()).toHaveLength(1);
    expect(boundary.analytics).toHaveBeenCalledTimes(1);
  });

  it("keeps a limit buy's XCP debit when quantity, side, asset and account change", async () => {
    await render(<TradePanel asset="TOKEN" xcpUsd={2} side="buy" />);
    await enter("Limit price in XCP per TOKEN", "2");
    await enter("Amount of TOKEN", "3.00000001");
    await click();
    expect(boundary.order).toHaveBeenCalledWith(expect.objectContaining({ give_asset: "XCP", give_quantity: 600000002n }));
    await phase("signing");
    await enter("Amount of TOKEN", "100");
    boundary.address = "edited-address";
    await render(<TradePanel asset="OTHER" xcpUsd={20} side="sell" />);
    await phase("confirmed", "limit-tx");
    expectReservation("XCP", 600000002n);
    expect(pendingSpentRaw("OTHER")).toBe(0n);
    expect(readPending()[0]).toMatchObject({ label: "Buy TOKEN — limit order" });
    expect(boundary.analytics).toHaveBeenCalledWith("limit-tx", "limit order", 12.00000004);
  });

  it("keeps both deposit legs and the submitted gas when switched to remove", async () => {
    await render(<LiquidityWidget assets={["TOKEN"]} xcpUsd={2} />);
    await enter("Amount of TOKEN to deposit", "100000000.00000001");
    await click();
    expect(boundary.deposit).toHaveBeenCalledWith(expect.objectContaining({ quantity_a: 10000000000000001n, quantity_b: 2000000001n }));
    await phase("signing");
    await enter("Amount of TOKEN to deposit", "1e5");
    await click("remove"); boundary.address = "edited-address";
    await phase("confirmed", "deposit-tx");
    expect(container.textContent).toContain("Deposit broadcast");
    expectReservation("TOKEN", 10000000000000001n);
    expectReservation("XCP", 2000000006n);
    expect(pendingSpentRaw("LP")).toBe(0n);
    expect(readPending()[0]).toMatchObject({ label: "Add TOKEN/XCP liquidity" });
    expect(boundary.analytics).toHaveBeenCalledWith("deposit-tx", "liquidity added", 80.00000004);
  });

  it("keeps exact LP withdrawal units and gas when percentage and mode change", async () => {
    await render(<LiquidityWidget assets={["TOKEN"]} xcpUsd={2} />);
    await click("remove"); await click();
    expect(boundary.withdraw).toHaveBeenCalledWith(expect.objectContaining({ lp_asset: "LP", quantity: 10000000000000001n }));
    await phase("signing"); await click("50%"); await click("add");
    boundary.address = "edited-address";
    await phase("confirmed", "withdraw-tx");
    expect(container.textContent).toContain("Withdrawal broadcast");
    expectReservation("LP", 10000000000000001n);
    expectReservation("XCP", 5n);
    expect(readPending()[0]).toMatchObject({ label: "Remove TOKEN/XCP liquidity" });
    expect(boundary.analytics).toHaveBeenCalledWith("withdraw-tx", "liquidity removed", 80.00000004);
  });

  it("releases a failed submitted record so a corrected new order can register", async () => {
    await render(<TradePanel asset="TOKEN" xcpUsd={2} side="sell" />);
    await enter("Limit price in XCP per TOKEN", "2"); await enter("Amount of TOKEN", "3");
    await click(); await phase("error");
    expect(readPending()).toHaveLength(0);
    await enter("Amount of TOKEN", "4"); await click();
    await phase("signing"); await phase("confirmed", "retry-tx");
    expectReservation("TOKEN", 400000000n);
    expect(boundary.order).toHaveBeenCalledTimes(2);
  });
});
