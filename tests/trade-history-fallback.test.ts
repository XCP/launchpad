import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTradeHistoryReader, tradeFingerprint } from "../apps/web/src/lib/api/trade-history";
const fetchTradeHistory = (asset: string, divisible: boolean, limit: number, offset: number, block = 0) =>
  createTradeHistoryReader(asset, divisible)(limit, offset, block);

const upstream = vi.hoisted(() => ({ index: vi.fn(), core: vi.fn() }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchAssetTradesPage: upstream.index }));
vi.mock("@/lib/client", () => ({ fetchJson: upstream.core }));
const match = (n: number) => ({ status: "valid", tx_hash: `tx-${n}`, tx_index: n, block_index: 965900 + n,
  source: "trader", forward_asset: "FEWGOODMAN", backward_asset: "XCP",
  forward_quantity: "100729766778896", backward_quantity: "1310000000" });
beforeEach(() => { vi.resetAllMocks(); upstream.index.mockResolvedValue({ result: [], total: 0, nextOffset: null }); });
describe("indexed and live trade history", () => {
  it("recovers a zero indexed count with exact live fills and complete pagination", async () => {
    upstream.core.mockImplementation(async (url: string) => url.includes("/orders/") ? { result: [], next_cursor: null }
      : url.includes("cursor=2") ? { result: Array.from({ length: 10 }, (_, n) => match(10 - n)), next_cursor: null }
        : { result: Array.from({ length: 50 }, (_, n) => match(60 - n)), next_cursor: 2 });
    const result = await fetchTradeHistory("FEWGOODMAN", true, 25, 50);
    expect(result.total).toBe(60); expect(result.result).toHaveLength(10);
    expect(result.result[0]).toMatchObject({ txHash: "tx-10", tokenDelta: "100729766778896", xcpDelta: "-1310000000", divisible: true });
    expect(result.nextOffset).toBeNull();
  });
  it("reports unavailable if either live venue fails instead of showing no trades or a partial count", async () => {
    upstream.core.mockImplementation(async (url: string) => {
      if (url.includes("/orders/")) throw new Error("HTTP 429");
      return { result: [match(1)], next_cursor: null };
    });
    await expect(fetchTradeHistory("FEWGOODMAN", true, 25, 0)).rejects.toThrow("HTTP 429");
  });
  it("uses a current populated index, but checks live fills when the room has newer trades", async () => {
    upstream.index.mockResolvedValue({ result: [{ block: 965901, tokenDelta: "1", xcpDelta: "-1" }], total: 1, nextOffset: null });
    expect((await fetchTradeHistory("FEWGOODMAN", true, 25, 0, 965901)).total).toBe(1);
    expect(upstream.core).not.toHaveBeenCalled();
    upstream.core.mockResolvedValue({ result: [], next_cursor: null });
    await fetchTradeHistory("FEWGOODMAN", true, 25, 0, 965902);
    expect(upstream.core).toHaveBeenCalledTimes(2);
  });
  it("rejects a repeated cursor rather than counting the same page twice", async () => {
    upstream.core.mockResolvedValue({ result: [match(1)], next_cursor: 2 });
    await expect(fetchTradeHistory("FEWGOODMAN", true, 25, 0)).rejects.toThrow("trade_history_incomplete");
  });
  it("keeps later pages on live history while the index remains behind the room", async () => {
    upstream.index.mockResolvedValue({ result: [{ block: 965901, tokenDelta: "1", xcpDelta: "-1" }], total: 50, nextOffset: null });
    upstream.core.mockImplementation(async (url: string) => ({
      result: url.includes("/pools/") ? Array.from({ length: 60 }, (_, n) => match(60 - n)) : [], next_cursor: null,
    }));
    const result = await fetchTradeHistory("FEWGOODMAN", true, 25, 25, 965960);
    expect(upstream.index).toHaveBeenCalledWith("FEWGOODMAN", 25, 0);
    expect(result.total).toBe(60);
    expect(result.result[0].txHash).toBe("tx-35");
    expect(result.nextOffset).toBe(50);
  });
  it("keeps one snapshot across pages even after the index catches up", async () => {
    upstream.core.mockImplementation(async (url: string) => ({
      result: url.includes("/pools/") ? Array.from({ length: 60 }, (_, n) => match(60 - n)) : [], next_cursor: null,
    }));
    const read = createTradeHistoryReader("FEWGOODMAN", true);
    const first = await read(25, 0, 965960);
    upstream.index.mockResolvedValue({ result: [{ block: 965970 }], total: 61, nextOffset: null });
    const second = await read(25, 25, 965970);
    expect(first.result[24].txHash).toBe("tx-36");
    expect(second.result[0].txHash).toBe("tx-35");
    expect(second.total).toBe(60);
    expect(upstream.core).toHaveBeenCalledTimes(2);
    expect(upstream.index).toHaveBeenCalledTimes(1);
  });
  it("does not treat equal block heights as proof that every known fill was indexed", async () => {
    upstream.index.mockResolvedValue({ result: [{ block: 965901, txHash: "old", tokenDelta: "1", xcpDelta: "-1" }], total: 1, nextOffset: null });
    upstream.core.mockImplementation(async (url: string) => ({ result: url.includes("/pools/") ? [match(1)] : [], next_cursor: null }));
    const known = tradeFingerprint({ txHash: "tx-1", address: "trader", buy: true, tokenQuantity: "100729766778896", xcpQuantity: "1310000000" });
    const result = await createTradeHistoryReader("FEWGOODMAN", true)(25, 0, 965901, [known]);
    expect(result.result[0].txHash).toBe("tx-1");
    expect(upstream.core).toHaveBeenCalledTimes(2);
  });
  it("carries the token's actual divisibility instead of inferring XCP units", async () => {
    upstream.core.mockImplementation(async (url: string) => ({ result: url.includes("/pools/") ? [{ ...match(1), forward_quantity: "100" }] : [], next_cursor: null }));
    expect((await fetchTradeHistory("FEWGOODMAN", false, 25, 0)).result[0]).toMatchObject({ tokenDelta: "100", xcpDelta: "-1310000000", divisible: false });
  });
});
