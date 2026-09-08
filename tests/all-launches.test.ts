import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_LAUNCHES_PAGE_SIZE, fetchAllLaunchesPage } from "@/lib/all-launches";
import type { IndexedLaunch, IndexedPage } from "@/lib/api/launchpad-api";
import type { LaunchPhase } from "@/lib/xcp69";

const boundary = vi.hoisted(() => ({ fetchPage: vi.fn() }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchLaunchPage: boundary.fetchPage }));

function row(n: number, phase: LaunchPhase = "minting"): IndexedLaunch {
  return {
    fm: {
      tx_hash: `tx-${n}`, tx_index: n, block_index: 99900, source: "source",
      asset: `TOKEN${n}`, asset_longname: null, description: "",
      price: "1000000", quantity_by_price: "100000000000", hard_cap: "10000000000000000",
      soft_cap: "6900000000000000", earned_quantity: "3450000000000000",
      paid_quantity: "34500000000", soft_cap_deadline_block: 100900, start_block: 99900,
      end_block: 0, burn_payment: false, max_mint_per_tx: "100000000000000",
      max_mint_per_address: "100000000000000", premint_quantity: "0",
      minted_asset_commission_int: "0", lock_description: true, lock_quantity: true,
      divisible: true, pool_quantity: "3100000000000000", lp_asset: null, status: "open",
    },
    phase, conforming: true, xcpDepth: 0n, poolXcpReserve: null, poolTokenReserve: null,
    announceBlock: 99800, minters: 35, lastMintBlock: 99950, launchTime: null,
    launchXcpUsd: null, priceDayAgoXcp: null, displayDescription: null, burnedQuantity: "0",
  };
}

function chunk(total: number, offset = 0, phase: LaunchPhase = "minting"): IndexedPage {
  return {
    rows: Array.from({ length: Math.min(100, Math.max(0, total - offset)) }, (_, n) => row(offset + n, phase)),
    total,
    king: null,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("200-row launch pages", () => {
  it.each([
    [0, 0, 0, 1], [100, 0, 100, 1], [101, 0, 101, 2], [200, 0, 200, 2],
    [201, 0, 200, 2], [201, 1, 1, 1], [400, 1, 200, 2], [201, 2, 0, 1],
  ])("returns a complete page for total %i, page %i", async (total, pageIndex, count, requests) => {
    boundary.fetchPage.mockImplementation(async (phase: LaunchPhase, _sort: string, _limit: number, offset: number) => chunk(total, offset, phase));

    const result = await fetchAllLaunchesPage("minting", "pace", pageIndex, 100000);

    expect(ALL_LAUNCHES_PAGE_SIZE).toBe(200);
    expect(result.total).toBe(total);
    expect(result.rows).toHaveLength(count);
    expect(result.rows.map((r) => r.fm.tx_hash)).toEqual(
      Array.from({ length: count }, (_, n) => `tx-${pageIndex * 200 + n}`),
    );
    expect(boundary.fetchPage).toHaveBeenCalledTimes(requests);
    expect(boundary.fetchPage).toHaveBeenNthCalledWith(1, "minting", "pace", 100, pageIndex * 200, undefined, 100000);
    if (requests === 2) {
      expect(boundary.fetchPage).toHaveBeenNthCalledWith(2, "minting", "pace", 100, pageIndex * 200 + 100, undefined, 100000);
    }
    if (count) expect(result.rows[0]).toMatchObject({ progress: 0.5, holders: null, minters: 35 });
  });

  it("waits for the first chunk and keeps the filter, sort and tip identical", async () => {
    let release!: (value: IndexedPage) => void;
    boundary.fetchPage.mockReturnValueOnce(new Promise<IndexedPage>((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(chunk(201, 100));
    const pending = fetchAllLaunchesPage("minting", "pace", 0, 100123, "wallet-address");
    expect(boundary.fetchPage).toHaveBeenCalledTimes(1);
    release(chunk(201));
    await pending;
    expect(boundary.fetchPage.mock.calls).toEqual([
      ["minting", "pace", 100, 0, "wallet-address", 100123],
      ["minting", "pace", 100, 100, "wallet-address", 100123],
    ]);
  });

  it.each(["graduated", "scheduled", "refunded"] as const)("preserves the %s phase and the supplied sort", async (phase) => {
    boundary.fetchPage.mockResolvedValue(chunk(1, 0, phase));
    const result = await fetchAllLaunchesPage(phase, "newest", 0);
    expect(result.rows[0]!.phase).toBe(phase);
    expect(boundary.fetchPage).toHaveBeenCalledWith(phase, "newest", 100, 0, undefined, undefined);
  });

  it("maps the separate crown without inserting it into the 200 sorted rows", async () => {
    boundary.fetchPage.mockResolvedValueOnce({ ...chunk(201), king: row(200) })
      .mockResolvedValueOnce(chunk(201, 100));
    const result = await fetchAllLaunchesPage("minting", "pace", 0, 100000);
    expect(result.king?.fm.tx_hash).toBe("tx-200");
    expect(result.rows).toHaveLength(200);
    expect(result.rows.some((r) => r.fm.tx_hash === "tx-200")).toBe(false);
  });

  it.each([["first", false], ["second", true]] as const)("rejects an unavailable %s chunk without returning partial data", async (_name, second) => {
    if (second) boundary.fetchPage.mockResolvedValueOnce(chunk(200));
    boundary.fetchPage.mockResolvedValueOnce(null);
    await expect(fetchAllLaunchesPage("minting", "pace", 0, 100000)).rejects.toThrow("all_launches_unavailable");
    expect(boundary.fetchPage).toHaveBeenCalledTimes(second ? 2 : 1);
  });

  it.each([0, 100])("rejects a truncated chunk at offset %i", async (offset) => {
    if (offset) boundary.fetchPage.mockResolvedValueOnce(chunk(200));
    boundary.fetchPage.mockResolvedValueOnce({ ...chunk(200, offset), rows: chunk(200, offset).rows.slice(1) });
    await expect(fetchAllLaunchesPage("minting", "pace", 0, 100000)).rejects.toThrow("all_launches_incomplete");
  });

  it("rejects a changed total between chunks", async () => {
    boundary.fetchPage.mockResolvedValueOnce(chunk(201)).mockResolvedValueOnce(chunk(202, 100));
    await expect(fetchAllLaunchesPage("minting", "pace", 0, 100000)).rejects.toThrow("all_launches_inconsistent_total");
  });

  it("propagates a rejected second read without accepting its first chunk", async () => {
    boundary.fetchPage.mockResolvedValueOnce(chunk(200)).mockRejectedValueOnce(new Error("read failed"));
    await expect(fetchAllLaunchesPage("minting", "pace", 0, 100000)).rejects.toThrow("read failed");
    expect(boundary.fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing launch identity", async () => {
    const first = chunk(1);
    first.rows[0]!.fm.tx_hash = "";
    boundary.fetchPage.mockResolvedValueOnce(first);
    await expect(fetchAllLaunchesPage("minting", "pace", 0)).rejects.toThrow("all_launches_inconsistent_rows");
  });

  it.each([false, true])("rejects duplicate hashes within or across chunks (across: %s)", async (across) => {
    const first = chunk(200), second = chunk(200, 100);
    if (across) second.rows[0] = first.rows[0]!;
    else first.rows[1] = first.rows[0]!;
    boundary.fetchPage.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await expect(fetchAllLaunchesPage("minting", "pace", 0, 100000)).rejects.toThrow("all_launches_inconsistent_rows");
  });

  it.each([0, 100])("rejects a different phase in the chunk at offset %i", async (offset) => {
    if (offset) boundary.fetchPage.mockResolvedValueOnce(chunk(200));
    const wrong = chunk(200, offset);
    wrong.rows[0] = row(offset, "graduated");
    boundary.fetchPage.mockResolvedValueOnce(wrong);
    await expect(fetchAllLaunchesPage("minting", "pace", 0, 100000)).rejects.toThrow("all_launches_inconsistent_rows");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, 501])("rejects page index %s before requesting data", async (pageIndex) => {
    await expect(fetchAllLaunchesPage("minting", "pace", pageIndex)).rejects.toThrow("all_launches_invalid_page");
    expect(boundary.fetchPage).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid total %s", async (total) => {
    boundary.fetchPage.mockResolvedValue({ rows: [], total, king: null });
    await expect(fetchAllLaunchesPage("minting", "pace", 0)).rejects.toThrow("all_launches_inconsistent_total");
  });

  it("does not let the API clamp a second offset beyond its supported range", async () => {
    boundary.fetchPage.mockResolvedValueOnce(chunk(100101, 100000));
    await expect(fetchAllLaunchesPage("minting", "pace", 500)).rejects.toThrow("all_launches_invalid_page");
    expect(boundary.fetchPage).toHaveBeenCalledTimes(1);
  });
});
