import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMarketPrices, fetchXcpUsd } from "@/lib/api/price";
import { fetchPendingXcpDispenses, fetchXcpDispensers } from "@/lib/api/counterparty";

vi.mock("@/lib/api/counterparty", () => ({ fetchPendingXcpDispenses: vi.fn(), fetchXcpDispensers: vi.fn() }));
const read = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", read);
  vi.mocked(fetchXcpDispensers).mockResolvedValue([]);
  vi.mocked(fetchPendingXcpDispenses).mockResolvedValue([]);
  read.mockResolvedValue(new Response(JSON.stringify({ result: {
    btc: { usd: 60000 }, xcp: { usd: 3, day: "2026-09-08" },
    history: [{ day: "2026-08-09", usd: 2, btc: 50000 }, { day: "2026-09-07", usd: 2.5, btc: 59000 }],
  } })));
});
afterEach(() => vi.unstubAllGlobals());

describe("shared directory market snapshot", () => {
  it("reads one ticker for both prices and all three reference values", async () => {
    expect(await fetchMarketPrices()).toEqual({ btc: 60000, xcp: 3, btcUsd30dAgo: 50000, xcpUsd30dAgo: 2, xcpUsdDayAgo: 2.5 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(fetchXcpDispensers).toHaveBeenCalledTimes(1);
    expect(fetchPendingXcpDispenses).toHaveBeenCalledTimes(1);
  });

  it("retains the existing spot reader's fallback behavior", async () => {
    expect(await fetchXcpUsd()).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps unavailable market values unknown instead of converting them to zero", async () => {
    read.mockRejectedValue(new Error("offline"));
    vi.mocked(fetchXcpDispensers).mockRejectedValue(new Error("offline"));
    vi.mocked(fetchPendingXcpDispenses).mockRejectedValue(new Error("offline"));
    expect(await fetchMarketPrices()).toEqual({ btc: null, xcp: null, btcUsd30dAgo: null, xcpUsd30dAgo: null, xcpUsdDayAgo: null });
  });
});
