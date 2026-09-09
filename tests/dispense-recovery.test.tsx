// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeRecovery } from "@/app/[lang]/dispense/_components/bridge-recovery";
import { loadXcpBridge } from "@/app/[lang]/dispense/_lib/load-bridge";
import { GET } from "@/app/api/xcp-dispensers/route";
import { fetchXcpDispensers, type Dispenser } from "@/lib/api/counterparty";
import { fetchMarketPrices } from "@/lib/api/price";
import { LocaleProvider } from "@/lib/i18n/client";

vi.mock("@/lib/api/counterparty", () => ({ fetchXcpDispensers: vi.fn() }));
vi.mock("@/lib/api/price", () => ({ fetchMarketPrices: vi.fn() }));
vi.mock("@/app/[lang]/dispense/_components/bridge", () => ({
  // Stands in for the ladder's own heading crank, which is the real
  // component's only refresh affordance once a book is on screen.
  XcpBridge: ({ dispensers, btcUsd, xcpUsd, onRefresh }: { dispensers: Dispenser[]; btcUsd: number | null; xcpUsd: number | null; onRefresh: () => void }) => <div data-bridge>
    <p>{dispensers.length ? "Available book" : "No open dispensers"}</p>
    <output>{btcUsd}:{xcpUsd}</output><input aria-label="Amount" defaultValue="draft" />
    <button type="button" data-refresh onClick={onRefresh}>Re-read book</button><button type="button">Buy XCP</button>
  </div>,
}));
const rows: Dispenser[] = [{ tx_hash: "a".repeat(64), source: "dispenser-address", give_quantity: 100_000_000, give_remaining: 1_000_000_000, satoshirate: 1000, price: 1000 }];
const prices = { btc: 60000, xcp: 3, btcUsd30dAgo: null, xcpUsd30dAgo: null, xcpUsdDayAgo: null };
const read = vi.fn();
let root: Root;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", read);
  vi.mocked(fetchXcpDispensers).mockResolvedValue(rows);
  vi.mocked(fetchMarketPrices).mockResolvedValue(prices);
  read.mockResolvedValue(Response.json({ dispensers: rows }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(dispensers: Dispenser[] | null) {
  await act(() => root.render(<LocaleProvider locale="en" messages={{}}><BridgeRecovery dispensers={dispensers} btcUsd={60000} xcpUsd={3} /></LocaleProvider>));
}
const button = () => container.querySelector("button")!;
async function click() { await act(async () => button().click()); }

describe("dispenser page partial data and recovery route", () => {
  it("loads one aggregate price snapshot and preserves the normal book", async () => {
    expect(await loadXcpBridge()).toEqual({ dispensers: rows, btcUsd: 60000, xcpUsd: 3 });
    expect(fetchXcpDispensers).toHaveBeenCalledTimes(1); expect(fetchMarketPrices).toHaveBeenCalledTimes(1);
  });
  it("keeps usable price context when the dispenser read exhausts its throttle budget", async () => {
    vi.mocked(fetchXcpDispensers).mockRejectedValue(new Error("Counterparty API 429: retry limit or read deadline reached"));
    expect(await loadXcpBridge()).toEqual({ dispensers: null, btcUsd: 60000, xcpUsd: 3 });
    expect(fetchXcpDispensers).toHaveBeenCalledTimes(1);
  });
  it("keeps a valid empty book distinct from an unavailable book or price feed", async () => {
    vi.mocked(fetchXcpDispensers).mockResolvedValue([]); vi.mocked(fetchMarketPrices).mockRejectedValue(new Error("offline"));
    expect(await loadXcpBridge()).toEqual({ dispensers: [], btcUsd: null, xcpUsd: null });
  });
  it("returns cacheable recovery data from one book read without reloading prices", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ dispensers: rows });
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    expect(fetchXcpDispensers).toHaveBeenCalledTimes(1); expect(fetchMarketPrices).not.toHaveBeenCalled();
  });
  it("returns an uncached retryable failure rather than an empty success", async () => {
    vi.mocked(fetchXcpDispensers).mockRejectedValue(new Error("private upstream path"));
    const response = await GET();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("retry-after")).toBe("15");
    expect(fetchXcpDispensers).toHaveBeenCalledTimes(1);
  });
});

describe("dispenser recovery interaction", () => {
  it("does not invent an empty market or fetch automatically when initial data is unavailable", async () => {
    vi.useFakeTimers(); await render(null);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("busy or unavailable");
    expect(container.textContent).not.toContain("No open dispensers"); expect(container.querySelector("[data-bridge]")).toBeNull();
    await act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
    await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(read).not.toHaveBeenCalled();
  });
  it("recovers on one explicit request and retains the successful price context", async () => {
    await render(null); await click();
    expect(read).toHaveBeenCalledTimes(1); expect(read.mock.calls[0][0]).toBe("/api/xcp-dispensers");
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector("output")?.textContent).toBe("60000:3");
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });
  it("renders confirmed emptiness only after a successful empty response", async () => {
    read.mockResolvedValue(Response.json({ dispensers: [] }));
    await render(null); await click();
    expect(container.textContent).toContain("No open dispensers"); expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("shows no banner or retry over a healthy book, and never reads on its own", async () => {
    vi.useFakeTimers(); await render(rows);
    expect(container.textContent).toContain("Available book"); expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Retry");
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(read).not.toHaveBeenCalled();
  });
  it("retires its recovery chrome once a retry succeeds, leaving the form live", async () => {
    await render(null); await click();
    expect(container.textContent).toContain("Available book"); expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Retry");
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });
  it("retains known rows and the draft after a failed refresh, blocking stale-book actions", async () => {
    await render(rows); const input = container.querySelector("input")!; input.value = "my exact draft";
    read.mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 }));
    await act(async () => { (container.querySelector("[data-refresh]") as HTMLButtonElement).click(); });
    expect(container.textContent).toContain("Available book"); expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("my exact draft"); expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });
  it("coalesces double clicks and respects the retry cooldown without automatic retries", async () => {
    vi.useFakeTimers(); let finish!: (value: Response) => void;
    read.mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    await render(null); await act(() => { button().click(); button().click(); });
    expect(read).toHaveBeenCalledTimes(1); expect(button().disabled).toBe(true);
    await act(async () => { finish(Response.json({ error: "unavailable" }, { status: 503, headers: { "retry-after": "30" } })); });
    expect(button().textContent).toBe("Wait 30s");
    await act(() => vi.advanceTimersByTimeAsync(29_000)); expect(button().disabled).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1000)); expect(button().textContent).toBe("Retry");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or unsafe recovery payloads without presenting a tradable book", async () => {
    await render(null); read.mockResolvedValue(Response.json({ dispensers: [{ ...rows[0], satoshirate: "1000" }] }));
    await click(); expect(container.querySelector("[data-bridge]")).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });
  it("aborts the pending recovery read when the page is left", async () => {
    read.mockReturnValue(new Promise(() => {})); await render(null); await act(() => button().click());
    const signal = read.mock.calls[0][1].signal as AbortSignal;
    await act(() => root.render(<span>Other page</span>)); expect(signal.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
