// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MintPanel } from "@/app/[lang]/[asset]/_components/mint-panel";
import type { IndexedLaunch } from "@/lib/api/launchpad-api";

const boundary = vi.hoisted(() => ({ indexed: vi.fn(), live: vi.fn(), fairminters: vi.fn(), committed: vi.fn(), address: "minter" as string | null }));
vi.mock("@/lib/api/launchpad-api", () => ({
  fetchIndexedLaunch: boundary.indexed,
  fetchMempoolSnapshot: async () => ({ mints: [] }),
}));
vi.mock("@/lib/api/counterparty", () => ({ fetchFairmintersByAsset: boundary.fairminters, fetchOriginalRecord: vi.fn() }));
vi.mock("@/lib/client", () => ({ fetchAddressFairmints: boundary.committed, fetchJson: boundary.live }));
vi.mock("@/lib/api/price-client", () => ({ fetchBtcUsd: async () => 80_000 }));
vi.mock("@xcp/wallet-sdk", () => ({ fetchFeeRate: async () => 1, registerPending: vi.fn() }));
vi.mock("@xcp/wallet-sdk/react/use-spendable-balance", () => ({ useSpendableBalance: () => ({ balance: 100_000_000_000n }) }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => ({ address: boundary.address, status: boundary.address ? "connected" : "disconnected" }) }));
vi.mock("@/lib/wallet/useCompose", () => ({ useCompose: () => ({ status: "idle", reset: vi.fn(), composeFairmint: vi.fn() }) }));
vi.mock("@/lib/currency", () => ({ useFiat: () => () => "$0" }));
vi.mock("@/lib/analytics", () => ({ trackTx: vi.fn() }));
vi.mock("@/components/asset-chip", () => ({ AssetChip: () => null }));
vi.mock("@/components/connect-button", () => ({ ConnectButton: () => null }));
vi.mock("@/components/lazy-link", () => ({ LazyLink: ({ children }: { children: ReactNode }) => <span>{children}</span> }));

function indexed(earned = "6899900000000000"): IndexedLaunch {
  return {
    fm: {
      tx_hash: "fairminter-hash", tx_index: 1, block_index: 965_100,
      asset: "EVOLVEDPEPE", asset_longname: null, source: "creator", description: "EvolvedPepe",
      divisible: true, start_block: 965_100, end_block: 0, soft_cap_deadline_block: 966_100,
      price: "1000000", quantity_by_price: "100000000000", hard_cap: "10000000000000000",
      soft_cap: "6900000000000000", pool_quantity: "3100000000000000",
      max_mint_per_tx: "100000000000000", max_mint_per_address: "100000000000000",
      premint_quantity: "0", minted_asset_commission_int: "0", burn_payment: false,
      lock_quantity: true, lock_description: true, lp_asset: "A69000000000000069",
      status: "open", earned_quantity: earned, paid_quantity: "0",
    },
    phase: "minting", conforming: true, xcpDepth: 0n,
    poolXcpReserve: null, poolTokenReserve: null, announceBlock: 965_064,
    originalDeadline: 966_100, minters: 2, lastMintBlock: null,
    launchTime: null, launchXcpUsd: null, priceDayAgoXcp: null,
    displayDescription: null, burnedQuantity: "0",
  };
}

let root: Root;
let container: HTMLDivElement;
let mutate: ReturnType<typeof useSWRConfig>["mutate"];
let cache: Map<string, never>;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function ObserveCache() { mutate = useSWRConfig().mutate; return null; }

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  boundary.indexed.mockResolvedValue(indexed());
  boundary.live.mockResolvedValue({ result: [indexed().fm] });
  boundary.fairminters.mockRejectedValue(new Error("protocol unavailable"));
  boundary.committed.mockResolvedValue(0n);
  boundary.address = "minter"; cache = new Map();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove(); vi.useRealTimers();
});
async function render() {
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false, keepPreviousData: true }}>
      <ObserveCache /><MintPanel asset="EVOLVEDPEPE" xcpUsd={2} />
    </SWRConfig>);
  });
}
const mintButton = () => [...container.querySelectorAll("button")].find((node) => /^Mint /.test(node.textContent ?? ""));
async function enter(tokens: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="EVOLVEDPEPE to mint"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, tokens);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

describe("actual mint panel display and transaction-time polling", () => {
  it("keeps the twenty-second direct node poll and fairminter-scoped cap for a connected wallet", async () => {
    await render();
    await enter("1000");
    expect(mintButton()?.textContent).toBe("Mint 1,000 EVOLVEDPEPE");
    expect(boundary.live).toHaveBeenCalledExactlyOnceWith("https://api.counterparty.io:4000/v2/assets/EVOLVEDPEPE/fairminters?limit=100&verbose=true");
    expect(boundary.committed).toHaveBeenCalledExactlyOnceWith("minter", "EVOLVEDPEPE", "fairminter-hash");
    await enter("2000");
    expect(mintButton()).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(19_999));
    expect(boundary.live).toHaveBeenCalledTimes(1);
    boundary.live.mockResolvedValue({ result: [indexed("6899800000000000").fm] });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(boundary.live).toHaveBeenCalledTimes(2);
    expect(mintButton()?.textContent).toBe("Mint 2,000 EVOLVEDPEPE");
    expect(boundary.fairminters).not.toHaveBeenCalled();
    expect(boundary.indexed).not.toHaveBeenCalled();
  });

  it("retains the valid cap on a failed refresh and recovers instead of showing a false zero allowance", async () => {
    await render();
    await enter("1000");
    boundary.live.mockRejectedValue(new Error("node unavailable"));
    await act(async () => { await mutate(["mint-fairminter", "EVOLVEDPEPE", true]); });
    expect(mintButton()?.textContent).toBe("Mint 1,000 EVOLVEDPEPE");
    expect(container.textContent).not.toContain("Address limit reached");
    boundary.live.mockResolvedValue({ result: [indexed("6899800000000000").fm] });
    await act(async () => { await mutate(["mint-fairminter", "EVOLVEDPEPE", true]); });
    await enter("2000");
    expect(mintButton()?.textContent).toBe("Mint 2,000 EVOLVEDPEPE");
    expect(boundary.indexed).not.toHaveBeenCalled();
  });

  it("does not clamp an initial failed read to zero or claim an address cap", async () => {
    boundary.live.mockRejectedValue(new Error("node unavailable"));
    await render();
    expect(mintButton()?.textContent).toBe("Mint 10,000 EVOLVEDPEPE");
    expect(container.textContent).not.toContain("Address limit reached");
    expect(boundary.committed).not.toHaveBeenCalled();
  });

  it("uses zero direct node fairminter reads while browsing, then reads live immediately on wallet connect", async () => {
    boundary.address = null;
    await render();
    expect(boundary.indexed).toHaveBeenCalledExactlyOnceWith("EVOLVEDPEPE", 30);
    expect(boundary.live).not.toHaveBeenCalled();
    boundary.address = "minter";
    boundary.live.mockResolvedValue({ result: [indexed("6899800000000000").fm] });
    await render(); await enter("2000");
    expect(boundary.live).toHaveBeenCalledTimes(1);
    expect(mintButton()?.textContent).toBe("Mint 2,000 EVOLVEDPEPE");
  });

  it("does not carry indexed allowance into a pending or failed live read when the wallet connects", async () => {
    boundary.address = null;
    boundary.indexed.mockResolvedValue(indexed("0"));
    await render();
    let rejectLive!: (error: Error) => void;
    boundary.live.mockImplementation(() => new Promise((_, reject) => { rejectLive = reject; }));
    boundary.address = "minter";
    await render();
    expect(boundary.live).toHaveBeenCalledTimes(1);
    expect(boundary.committed).not.toHaveBeenCalled();
    await act(async () => { rejectLive(new Error("node unavailable")); });
    expect(boundary.committed).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Address limit reached");
    expect(mintButton()?.textContent).toBe("Mint 10,000 EVOLVEDPEPE");
  });
});
