import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAssetOrigin } from "@/lib/api/asset-origin";

const launchHash = "a".repeat(64);
const earlierHash = "b".repeat(64);
const fetchMock = vi.fn();
const issuance = (overrides: Record<string, unknown> = {}) => ({
  asset: "EXAMPLE",
  tx_hash: launchHash,
  tx_index: 300,
  msg_index: 0,
  block_index: 900_000,
  block_time: 1_740_000_000,
  asset_events: "open_fairminter",
  status: "valid",
  ...overrides,
});
const respond = (rows: unknown[], count = rows.length) => fetchMock.mockResolvedValue(
  new Response(JSON.stringify({ result: rows, result_count: count })),
);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("asset origin", () => {
  it("identifies a name created by this fairminter with one bounded cached request", async () => {
    respond([issuance()]);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toEqual({ kind: "new" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/assets/EXAMPLE/issuances?limit=10&verbose=true&sort=block_index:asc");
    expect(options.next).toEqual({ revalidate: 300 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the first issuance's UTC year for an old reused name", async () => {
    respond([
      issuance({ tx_hash: earlierHash, block_index: 335_000, tx_index: 1, block_time: 1_420_070_400, asset_events: "creation" }),
      issuance(),
    ]);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toEqual({ kind: "existing", year: 2015 });
  });

  it("does not confuse earlier creation in the same block with a new fairminter asset", async () => {
    respond([
      issuance(),
      issuance({ tx_hash: earlierHash, tx_index: 299, asset_events: "creation" }),
    ]);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toEqual({ kind: "existing", year: 2025 });
  });

  it("recognizes a separate earlier issuance message in the fairminter's transaction", async () => {
    respond([
      issuance({ msg_index: 1 }),
      issuance({ msg_index: 0, asset_events: "creation" }),
    ]);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toEqual({ kind: "existing", year: 2025 });
  });

  it("can identify the first block without fetching later issuance pages", async () => {
    respond([
      issuance(),
      issuance({ block_index: 900_001, tx_index: 301, tx_hash: earlierHash, asset_events: "fairmint" }),
    ], 10_000);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toEqual({ kind: "new" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("withholds provenance when the first-block sample may omit earlier transactions", async () => {
    respond(Array.from({ length: 10 }, (_, index) => issuance({ tx_index: 300 + index })), 11);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [],
    [issuance({ asset: "DIFFERENT" })],
    [issuance({ status: "invalid" })],
    [issuance({ tx_hash: null })],
    [issuance({ block_index: null })],
    [issuance({ tx_hash: earlierHash, block_time: null })],
  ])("does not turn absent or malformed evidence into a new-asset claim: %j", async (...rows) => {
    respond(rows);
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toBeNull();
  });

  it("leaves provenance unknown when the upstream request fails", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toBeNull();
    fetchMock.mockResolvedValue(new Response("throttled", { status: 429 }));
    expect(await fetchAssetOrigin("EXAMPLE", launchHash)).toBeNull();
  });
});
