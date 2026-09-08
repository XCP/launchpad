// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidatePending, registerPending } from "@xcp/wallet-sdk";
import { ProfileXcpBalance } from "@/app/[lang]/profile/_components/profile-xcp-balance";
import { useOpenMints } from "@/app/[lang]/profile/_lib/use-open-mints";
import { committedXcp } from "@/lib/profile-xcp";
import { fetchMintsBySource, type MintRecord } from "@/lib/api/launchpad-api";

vi.mock("@/lib/api/launchpad-api", () => ({ fetchMintsBySource: vi.fn() }));

const mint = (phase: MintRecord["phase"], paid: string): MintRecord => ({
  phase, paid, txHash: `${phase}-${paid}`, asset: "TOKEN", divisible: true, block: 1, earned: "100000000",
});
let root: Root;
let container: HTMLDivElement;
let cache: Map<string, never>;
let balanceResponse: (address: string) => Promise<Response>;
let pendingResponse: (address: string) => Promise<Response>;
const network = vi.fn();
const openMints = vi.fn();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); invalidatePending();
  cache = new Map();
  balanceResponse = async () => Response.json({ result: [{ quantity: "12575000000" }] });
  pendingResponse = async () => Response.json({ result: [] });
  network.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes("/balances/XCP")) {
      expect(url.searchParams.get("type")).toBe("address");
      return balanceResponse(decodeURIComponent(url.pathname.split("/")[3]));
    }
    if (url.pathname.endsWith("/addresses/mempool")) {
      return pendingResponse(url.searchParams.get("addresses")!);
    }
    throw new Error(`Unexpected network request ${url}`);
  });
  vi.stubGlobal("fetch", network);
  vi.mocked(fetchMintsBySource).mockResolvedValue([mint("minting", "2500000000"), mint("graduated", "9900000000"), mint("refunded", "1800000000")]);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});

function SharedMintConsumer() {
  useOpenMints("address-one");
  return null;
}

async function render(address = "address-one", extra?: ReactNode) {
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => cache, keepPreviousData: true, errorRetryCount: 0, shouldRetryOnError: false, dedupingInterval: 10_000 }}>
        <ProfileXcpBalance address={address} onOpenMints={openMints} />
        {extra}
      </SWRConfig>,
    );
  });
}

const column = (label: string) => [...container.querySelectorAll("dt")].find((node) => node.textContent === label)!.parentElement!;
const value = (label: string) => column(label).querySelector("dd")!.textContent;

describe("public profile XCP summary", () => {
  it("shows cash and only open-mint escrow without a wallet provider", async () => {
    await render("address-one", <SharedMintConsumer />);
    expect(value("Available XCP")).toBe("125.75");
    expect(value("XCP committed")).toBe("25");
    // The readiness observer adds no fetch. The Minting tab shares its read.
    expect(network).toHaveBeenCalledTimes(2);
    expect(fetchMintsBySource).toHaveBeenCalledExactlyOnceWith("address-one");
    await act(() => column("XCP committed").querySelector("button")!.click());
    expect(openMints).toHaveBeenCalledTimes(1);
  });

  it("shows a real zero balance and zero commitment", async () => {
    balanceResponse = async () => Response.json({ result: [] });
    vi.mocked(fetchMintsBySource).mockResolvedValue([]);
    await render();
    expect(value("Available XCP")).toBe("0");
    expect(value("XCP committed")).toBe("0");
  });

  it("deducts node and local outgoing spends once, excluding attached XCP", async () => {
    balanceResponse = async () => Response.json({ result: [
      { quantity: "10000000000", utxo: null },
      { quantity: "9000000000", utxo: "attached:0" },
    ] });
    pendingResponse = async (address) => Response.json({ result: [
      { event: "DEBIT", tx_hash: "seen", params: { address, asset: "XCP", quantity: "1000000000" } },
      { event: "DEBIT", tx_hash: "other", params: { address: "someone-else", asset: "XCP", quantity: "9900000000" } },
    ] });
    registerPending({ txid: "seen", kind: "fairmint", label: "seen", address: "address-one", spends: [{ asset: "XCP", raw: "1000000000" }] });
    registerPending({ txid: "local", kind: "fairmint", label: "local", address: "address-one", spends: [{ asset: "XCP", raw: "500000000" }] });
    await render();
    expect(value("Available XCP")).toBe("85");
    expect(column("Available XCP").textContent).toContain("15 XCP pending outgoing");
    expect(value("XCP committed")).toBe("25");
  });

  it("does not label confirmed cash as available before pending debits arrive", async () => {
    let resolve!: (response: Response) => void;
    pendingResponse = () => new Promise((done) => { resolve = done; });
    await render();
    expect(value("Available XCP")).toBe("Loading…");
    expect(value("XCP committed")).toBe("25");
    await act(async () => resolve(Response.json({ result: [] })));
    expect(value("Available XCP")).toBe("125.75");
  });

  it.each(["balance", "pending"])("shows unavailable for a failed %s read instead of zero", async (which) => {
    const fail = async () => new Response("Unavailable", { status: 400 });
    if (which === "balance") balanceResponse = fail;
    else pendingResponse = fail;
    await render();
    expect(value("Available XCP")).toBe("Balance unavailable");
    expect(value("XCP committed")).toBe("25");
  });

  it("keeps the cash balance useful when the mint index is unavailable", async () => {
    vi.mocked(fetchMintsBySource).mockResolvedValue(null);
    await render();
    expect(value("Available XCP")).toBe("125.75");
    expect(value("XCP committed")).toBe("Balance unavailable");
  });

  it("never shows the previous address's amounts during navigation", async () => {
    await render();
    expect(value("Available XCP")).toBe("125.75");
    balanceResponse = () => new Promise(() => {});
    pendingResponse = () => new Promise(() => {});
    vi.mocked(fetchMintsBySource).mockImplementation(() => new Promise(() => {}));
    await render("address-two");
    expect(value("Available XCP")).toBe("Loading…");
    expect(value("XCP committed")).toBe("Loading…");
    expect(container.textContent).not.toContain("125.75");
    expect(container.textContent).not.toContain("25");
  });

  it("preserves eight decimal places and integers beyond Number precision", async () => {
    balanceResponse = async () => Response.json({ result: [{ quantity: "9007199254740993" }] });
    vi.mocked(fetchMintsBySource).mockResolvedValue([mint("minting", "9007199254740993")]);
    await render();
    expect(value("Available XCP")).toBe("90,071,992.54740993");
    expect(value("XCP committed")).toBe("90,071,992.54740993");
  });
});

describe("committed XCP", () => {
  it("distinguishes unknown or malformed data from genuine empty escrow", () => {
    expect(committedXcp(undefined)).toBeNull();
    expect(committedXcp(null)).toBeNull();
    expect(committedXcp([mint("minting", "bad")])).toBeNull();
    expect(committedXcp([mint("minting", "-1")])).toBeNull();
    expect(committedXcp([])).toBe(0n);
    expect(committedXcp([mint("graduated", "200"), mint("refunded", "300"), mint("minting", "2"), mint("minting", "3")])).toBe(5n);
  });
});
