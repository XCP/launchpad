// @vitest-environment happy-dom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwapWidget } from "../apps/web/src/app/[lang]/swap/_components/swap-widget";

const boundary = vi.hoisted(() => ({
  compose: vi.fn(), fetch: vi.fn(), keys: [] as string[],
  quote: { estimated_output: "10000000000000001", pool_output: "10000000000000001", book_output: "0", price_impact: 0 },
}));
vi.mock("@/lib/wallet/useCompose", () => ({ useCompose: () => ({ status: "idle", composeOrder: boundary.compose }) }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => ({ address: "address", status: "connected" }) }));
vi.mock("@xcp/wallet-sdk/react/use-spendable-balance", () => ({ useSpendableBalance: () => ({ balance: 9000000000000000000n, pendingOutgoing: 0n }) }));
vi.mock("@/lib/client", () => ({ fetchJson: boundary.fetch }));
vi.mock("@/hooks/use-debounced", () => ({ useDebounced: (value: unknown) => value }));
vi.mock("@/hooks/use-mempool", () => ({ useMempool: () => ({ orders: [] }) }));
vi.mock("@/lib/currency", () => ({ useFiat: () => () => "$0", useFxRate: () => ({ code: "USD", rate: 1 }) }));
vi.mock("@/lib/analytics", () => ({ trackTx: vi.fn() }));
vi.mock("@/app/[lang]/swap/_components/swap-settings", () => ({ useSwapSettings: () => ({ slippage: 1, slippageAuto: false, customSlip: 1, expiration: 100, customFee: 0.1, swapSettingsValid: true, medianFeeRate: 1, setAutoValue: () => {} }) }));
vi.mock("swr", () => ({ default: (key: unknown) => {
  if (typeof key === "string") boundary.keys.push(key);
  return { data: typeof key === "string" && key.includes("/quote?") ? boundary.quote : undefined, isValidating: false, mutate: vi.fn() };
} }));
vi.mock("@/components/ui/button", () => ({ CTA: ({ children, ...props }: { children: ReactNode }) => <button data-testid="submit" {...props}>{children}</button> }));
vi.mock("@/components/asset-chip", () => ({ AssetChip: () => null }));
vi.mock("@/components/token-select-modal", () => ({ TokenSelectModal: () => null }));
vi.mock("@/components/order-tracker", () => ({ OrderTracker: () => null }));
vi.mock("@/components/connect-button", () => ({ ConnectButton: () => null }));
vi.mock("@/components/quote-ring", () => ({ QuoteRing: () => null }));

let root: Root;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  boundary.compose.mockReset(); boundary.fetch.mockReset(); boundary.keys = [];
  boundary.fetch.mockResolvedValue({ result: boundary.quote });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<SwapWidget assets={["TOKEN"]} xcpUsd={1} />));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); });
async function enter(value: string) {
  const input = container.querySelector("input")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
const button = () => container.querySelector<HTMLButtonElement>("[data-testid=submit]")!;

describe("rendered swap draft to quote to compose", () => {
  it("preserves a raw quantity beyond double precision through both boundaries", async () => {
    await enter("100000000.00000001");
    expect(button().disabled).toBe(false);
    expect(boundary.keys.some(key => key.endsWith("quantity=10000000000000001"))).toBe(true);
    await act(async () => { button().click(); });
    expect(boundary.compose).toHaveBeenCalledWith(expect.objectContaining({ give_quantity: 10000000000000001n, fee_rate: 0.1 }));
  });
  it("does not quote or submit an invalid edit over a previously valid quantity", async () => {
    await enter("5"); boundary.keys = [];
    await enter("5e2");
    expect(container.querySelector("input")!.value).toBe("5e2");
    expect(button().disabled).toBe(true);
    expect(boundary.keys.some(key => key.includes("/quote?"))).toBe(false);
    await act(() => { button().click(); });
    expect(boundary.compose).not.toHaveBeenCalled();
  });
  it("blocks a failed refresh instead of composing cached terms", async () => {
    await enter("5"); boundary.fetch.mockRejectedValueOnce(new Error("HTTP 429"));
    await act(async () => { button().click(); });
    expect(boundary.compose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Could not refresh the quote");
  });
  it("invalidates an in-flight submission when the editable intent changes", async () => {
    let resolve!: (value: unknown) => void;
    boundary.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await enter("5"); await act(() => { button().click(); });
    await enter("6");
    await act(async () => { resolve({ result: boundary.quote }); });
    expect(boundary.compose).not.toHaveBeenCalled();
  });
  it("allows only one submission while the final quote is refreshing", async () => {
    let resolve!: (value: unknown) => void;
    boundary.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await enter("5");
    await act(() => { button().click(); button().click(); });
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    await act(async () => { resolve({ result: boundary.quote }); });
    expect(boundary.compose).toHaveBeenCalledTimes(1);
  });
  it("never lowers the displayed minimum when a fresh quote is slightly worse", async () => {
    await enter("5");
    boundary.fetch.mockResolvedValueOnce({ result: { ...boundary.quote, estimated_output: "9990000000000000" } });
    await act(async () => { button().click(); });
    expect(boundary.compose.mock.calls[0]![0].get_quantity).toBe(9900000000000000n);
  });
});
