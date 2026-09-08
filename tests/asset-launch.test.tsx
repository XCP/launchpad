import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LaunchPage, { generateMetadata } from "@/app/[lang]/[asset]/page";
import { fetchAssetLaunch, fetchLaunchOriginal } from "@/lib/api/asset-launch";
import { isXcp69, windowIsExact } from "@/lib/xcp69";

const boundary = vi.hoisted(() => ({
  fairminters: vi.fn(), original: vi.fn(), mempool: vi.fn(), mints: vi.fn(), pool: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: {} }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
vi.mock("@/app/[lang]/[asset]/_components/launch-view", () => ({ LaunchView: () => null }));
vi.mock("@/lib/api/price", () => ({ fetchMarketPrices: async () => ({ xcp: 2, btc: 80_000 }) }));
vi.mock("@/lib/api/counterparty", () => ({
  fetchFairmintersByAsset: boundary.fairminters,
  fetchOriginalRecord: boundary.original,
  fetchMempoolFairminter: boundary.mempool,
  fetchFairmints: boundary.mints,
  fetchPool: boundary.pool,
  fetchBlockHeight: async () => 966_000,
  fetchHolderConcentration: async () => null,
  fetchHolderCount: async () => 0,
  fetchPairActivity: async () => ({ activities: [], volume: null }),
  fetchPriceSeries: async () => [],
}));

const row = () => ({
  tx_hash: "a".repeat(64), tx_index: 1, asset: "EVOLVEDPEPE", asset_longname: null,
  source: "creator", divisible: 1, start_block: 965_100, end_block: 0,
  announce_block: 965_064, original_deadline: 966_100, current_deadline_block: 966_100,
  price: "1000000", quantity_by_price: "100000000000", hard_cap: "10000000000000000",
  soft_cap: "6900000000000000", pool_quantity: "3100000000000000",
  max_mint_per_tx: "100000000000000", max_mint_per_address: "100000000000000",
  premint_quantity: "0", minted_asset_commission_int: "0", burn_payment: 0,
  lock_quantity: 1, lock_description: 1, lp_asset: "A69000000000000069",
  description: "EvolvedPepe creator prose", display_description: null as string | null,
  status: "open", phase: "minting", earned_quantity: "12300000000000", paid_quantity: "123000000",
  pool_xcp_sats: 0, pool_xcp_reserve: null, pool_token_reserve: null,
  minters: 2, conforming: 1 as number | null, burned_quantity: "0",
});
let indexedRow: ReturnType<typeof row> | null;
let indexError: boolean;
const network = vi.fn();
const params = () => Promise.resolve({ lang: "en", asset: "EVOLVEDPEPE" });

beforeEach(() => {
  vi.clearAllMocks();
  indexedRow = row(); indexError = false;
  boundary.fairminters.mockResolvedValue([]);
  boundary.mempool.mockResolvedValue(null);
  boundary.original.mockResolvedValue({ deadline: 966_100, announceBlock: 965_064 });
  boundary.mints.mockResolvedValue([]); boundary.pool.mockResolvedValue(null);
  network.mockImplementation(async (input: string) => {
    const url = new URL(input);
    expect(url.origin).toBe("https://api.xcp.fun");
    if (url.pathname === "/v2/launches/EVOLVEDPEPE") {
      if (indexError) throw new Error("index temporarily unavailable");
      return Response.json({ result: indexedRow });
    }
    if (url.pathname === "/v2/launches/EVOLVEDPEPE/fees") return Response.json({ result: null });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => vi.unstubAllGlobals());

describe("EVOLVEDPEPE indexed fairminter hot path", () => {
  it("renders a closed page and metadata with zero fairminter/creation reads when indexed creation evidence is complete", async () => {
    indexedRow!.status = "closed"; indexedRow!.phase = "refunded";
    const page = await LaunchPage({ params: params() });
    const metadata = await generateMetadata({ params: params() });
    expect(page.props).toMatchObject({ asset: "EVOLVEDPEPE", phase: "refunded", conforming: true });
    expect(page.props.fm.earned_quantity).toBe("12300000000000");
    expect(metadata.description).toBe("EvolvedPepe creator prose");
    expect(boundary.fairminters).not.toHaveBeenCalled();
    expect(boundary.original).not.toHaveBeenCalled();
    expect(boundary.mempool).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledWith("https://api.xcp.fun/v2/launches/EVOLVEDPEPE", expect.objectContaining({ next: { revalidate: 30 } }));
  });

  it("immediately renders a closed node status even while the index still says open", async () => {
    const fm = (await fetchAssetLaunch("EVOLVEDPEPE")).fm!;
    boundary.fairminters.mockResolvedValue([{ ...fm, status: "closed", soft_cap_deadline_block: 965_900 }]);
    const page = await LaunchPage({ params: params() });
    expect(page.props).toMatchObject({ phase: "refunded", conforming: true });
    expect(page.props.fm.status).toBe("closed");
    expect(page.props.fm.soft_cap_deadline_block).toBe(965_900);
    expect(boundary.fairminters).toHaveBeenCalledExactlyOnceWith("EVOLVEDPEPE");
    expect(boundary.original).not.toHaveBeenCalled();
  });

  it("immediately renders an opened node status even while the index still says pending", async () => {
    indexedRow!.status = "pending";
    const fm = (await fetchAssetLaunch("EVOLVEDPEPE")).fm!;
    boundary.fairminters.mockResolvedValue([{ ...fm, status: "open", block_index: fm.start_block }]);
    const page = await LaunchPage({ params: params() });
    expect(page.props).toMatchObject({ phase: "minting", conforming: true });
    expect(boundary.fairminters).toHaveBeenCalledExactlyOnceWith("EVOLVEDPEPE");
  });

  it("fails a live-status render instead of serving a stale indexed lifecycle on node failure", async () => {
    boundary.fairminters.mockRejectedValue(new Error("live status unavailable"));
    await expect(LaunchPage({ params: params() })).rejects.toThrow("live status unavailable");
    expect(boundary.mempool).not.toHaveBeenCalled();
  });

  it("uses the real creation block for a confirmed scheduled launch", async () => {
    indexedRow!.status = "pending";
    const launch = await fetchAssetLaunch("EVOLVEDPEPE");
    expect(launch.fm!.block_index).toBe(965_064);
    expect(isXcp69(launch.fm!)).toBe(true);
    expect(boundary.fairminters).not.toHaveBeenCalled();
  });

  it("re-asks the browser API instead of reusing a stored allowance response", async () => {
    vi.stubGlobal("window", {});
    await fetchAssetLaunch("EVOLVEDPEPE");
    expect(network).toHaveBeenCalledWith("https://api.xcp.fun/v2/launches/EVOLVEDPEPE", expect.objectContaining({ cache: "no-store" }));
  });

  it("keeps original creation-window checks after an early closed settlement", async () => {
    indexedRow!.status = "closed"; indexedRow!.current_deadline_block = 965_800;
    const launch = await fetchAssetLaunch("EVOLVEDPEPE");
    const original = await fetchLaunchOriginal(launch);
    expect(original.deadline).toBe(966_100);
    expect(windowIsExact(launch.fm!, original.deadline)).toBe(true);
    indexedRow!.original_deadline = 965_900; indexedRow!.conforming = 0;
    const short = await fetchAssetLaunch("EVOLVEDPEPE");
    expect(short.indexed!.conforming).toBe(false);
    expect(windowIsExact(short.fm!, (await fetchLaunchOriginal(short)).deadline)).toBe(false);
    expect(boundary.original).not.toHaveBeenCalled();
  });

  it("falls back for missing immutable evidence instead of using the rewritten deadline", async () => {
    indexedRow!.status = "closed"; indexedRow!.current_deadline_block = 965_800;
    Object.assign(indexedRow!, { original_deadline: null, announce_block: null });
    const launch = await fetchAssetLaunch("EVOLVEDPEPE");
    expect(await fetchLaunchOriginal(launch)).toEqual({ deadline: 966_100, announceBlock: 965_064 });
    expect(boundary.original).toHaveBeenCalledExactlyOnceWith("a".repeat(64));
  });

  it("retains the creation-event fallback for the live EVOLVEDPEPE indexed shape", async () => {
    // Observed read-only from production D1 on 2026-09-08 at 07:53 UTC.
    // A verified old row can still lack its immutable original deadline.
    Object.assign(indexedRow!, {
      status: "closed", phase: "graduated", conforming: 1,
      start_block: 964_101, announce_block: 963_804, original_deadline: null,
      current_deadline_block: 964_199, seen_at_block: 964_199, updated_at: 1_788_835_815,
    });
    boundary.original.mockResolvedValue({ deadline: 965_101, announceBlock: 963_804 });
    const launch = await fetchAssetLaunch("EVOLVEDPEPE");
    expect(await fetchLaunchOriginal(launch)).toEqual({ deadline: 965_101, announceBlock: 963_804 });
    expect(boundary.original).toHaveBeenCalledExactlyOnceWith("a".repeat(64));
    expect(boundary.fairminters).not.toHaveBeenCalled();
  });

  it("uses the routed confirmed lookup for a pending indexed row without announcement evidence", async () => {
    indexedRow!.status = "pending";
    const fm = (await fetchAssetLaunch("EVOLVEDPEPE")).fm;
    Object.assign(indexedRow!, { announce_block: null, conforming: null });
    boundary.fairminters.mockResolvedValue([fm]);
    const launch = await fetchAssetLaunch("EVOLVEDPEPE");
    expect(isXcp69(launch.fm!)).toBe(true);
    expect(launch.indexed!.conforming).toBe(false);
    expect(boundary.fairminters).toHaveBeenCalledExactlyOnceWith("EVOLVEDPEPE");
    expect(boundary.mempool).not.toHaveBeenCalled();
  });

  it.each([0, null, undefined])("never invents a verified conformance verdict from %s", async (conforming) => {
    Object.assign(indexedRow!, { conforming });
    expect((await fetchAssetLaunch("EVOLVEDPEPE")).indexed!.conforming).toBe(false);
  });

  it("does not treat an indexed nonconforming confirmed asset as a new mempool launch", async () => {
    indexedRow!.price = "2000000"; indexedRow!.conforming = 0; indexedRow!.status = "closed";
    await expect(LaunchPage({ params: params() })).rejects.toThrow(";404");
    expect(boundary.fairminters).not.toHaveBeenCalled();
    expect(boundary.mempool).not.toHaveBeenCalled();
  });

  it("treats a malformed indexed payload as a failed read, not a confirmed nonconforming asset", async () => {
    Object.assign(indexedRow!, { asset: undefined, tx_hash: undefined });
    boundary.fairminters.mockRejectedValue(new Error("protocol unavailable"));
    await expect(LaunchPage({ params: params() })).rejects.toThrow("protocol unavailable");
    expect(boundary.mempool).not.toHaveBeenCalled();
  });

  it("uses the routed protocol fallback when the index is missing or unavailable", async () => {
    const fm = (await fetchAssetLaunch("EVOLVEDPEPE")).fm;
    boundary.fairminters.mockResolvedValue([fm]);
    indexedRow = null;
    expect((await fetchAssetLaunch("EVOLVEDPEPE")).fm).toEqual(fm);
    indexError = true;
    expect((await fetchAssetLaunch("EVOLVEDPEPE")).fm).toEqual(fm);
    expect(boundary.fairminters).toHaveBeenNthCalledWith(1, "EVOLVEDPEPE");
    expect(boundary.fairminters).toHaveBeenCalledTimes(2);
  });

  it("keeps a newly broadcast launch distinct from a missing or failed read", async () => {
    const fm = (await fetchAssetLaunch("EVOLVEDPEPE")).fm;
    indexedRow = null; boundary.mempool.mockResolvedValue(fm);
    const page = await LaunchPage({ params: params() });
    expect(page.props.fm.confirmed).toBe(false);
    expect(boundary.mempool).toHaveBeenCalledExactlyOnceWith("EVOLVEDPEPE");
    expect(boundary.mints).not.toHaveBeenCalled();
    boundary.mempool.mockClear(); indexError = true;
    boundary.fairminters.mockRejectedValue(new Error("protocol unavailable"));
    await expect(LaunchPage({ params: params() })).rejects.toThrow("protocol unavailable");
    expect(boundary.mempool).not.toHaveBeenCalled();
  });
});
