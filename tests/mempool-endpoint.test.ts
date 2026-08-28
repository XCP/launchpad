/**
 * The mempool feed, as apps/api now serves it to the browser.
 *
 * This moved out of the client (two Counterparty requests per open tab) and
 * behind /v2/mempool, and a move like that is exactly where a filter goes
 * quietly missing: the page still renders, the count is just wrong. Every rule
 * the old client applied is asserted here against fixtures, because the live
 * mempool is empty most of the time and a parity check against it passes
 * trivially when there is nothing in it — which is precisely when it proves
 * nothing.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchMempoolFairmints,
  fetchMempoolFairminters,
} from "#api/integrations/counterparty";
import { fetchBlockHeight } from "@/lib/api/counterparty";

const mintEvent = (over: Record<string, unknown> = {}) => ({
  tx_hash: "aa".repeat(32),
  params: {
    asset: "TESTCOIN",
    source: "1AAA",
    earn_quantity: 100000000000000,
    paid_quantity: 1000000000,
    status: "valid",
    asset_info: { divisible: true },
    ...over,
  },
});

/** Raw response TEXT, never a JS object. An object literal carrying a value
 *  past 2^53 has already been rounded by the time JSON.stringify sees it, so
 *  building fixtures that way would test the lossless parser against digits
 *  JavaScript had already destroyed — and it would pass. */
const mockFetchRaw = (text: string, ok = true) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, text: async () => text })),
  );
};

const mockFetch = (body: unknown, ok = true) =>
  mockFetchRaw(JSON.stringify(body), ok);

afterEach(() => vi.unstubAllGlobals());

describe("fetchBlockHeight", () => {
  it("falls back to the existing xcp.io tip when Counterparty is throttled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"result":{"tip":964330,"indexed_block":"964330"}}',
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchBlockHeight()).toBe(964330);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.xcp.io/v2/");
  });
});

describe("fetchMempoolFairmints", () => {
  it("maps to the camelCase shape the browser consumes verbatim", async () => {
    mockFetch({ result: [mintEvent()] });
    const [m] = await fetchMempoolFairmints();
    expect(m).toEqual({
      txHash: "aa".repeat(32),
      asset: "TESTCOIN",
      source: "1AAA",
      earnQuantity: 100000000000000,
      paidQuantity: 1000000000,
      divisible: true,
    });
  });

  it("drops mints that will never credit anyone", async () => {
    // An invalid mint sits in the mempool and is real, but it cannot pay out.
    mockFetch({ result: [mintEvent({ status: "invalid" })] });
    expect(await fetchMempoolFairmints()).toEqual([]);
  });

  it("keeps a mint whose status the node omits entirely", async () => {
    mockFetch({ result: [mintEvent({ status: undefined })] });
    expect(await fetchMempoolFairmints()).toHaveLength(1);
  });

  it("drops null quantities rather than treating them as zero", async () => {
    // Counting null as 0 would understate a total the page presents as exact.
    mockFetch({ result: [mintEvent({ earn_quantity: null })] });
    expect(await fetchMempoolFairmints()).toEqual([]);
    mockFetch({ result: [mintEvent({ paid_quantity: null })] });
    expect(await fetchMempoolFairmints()).toEqual([]);
  });

  it("defaults divisible to true when asset_info is absent", async () => {
    mockFetch({ result: [mintEvent({ asset_info: null })] });
    const [m] = await fetchMempoolFairmints();
    expect(m.divisible).toBe(true);
  });

  it("preserves quantities past 2^53", async () => {
    // The standard's hard cap is 1e16, above 2^53. Native JSON.parse rounds
    // this digit away; parseJsonLossless is what keeps it, and a mint amount
    // that silently loses its last digit is wrong in a way nothing on screen
    // would reveal.
    mockFetchRaw(
      '{"result":[{"tx_hash":"cc","params":{"asset":"BIG","source":"1A",' +
        '"earn_quantity":10000000000000001,"paid_quantity":1,"status":"valid"}}]}',
    );
    const [m] = await fetchMempoolFairmints();
    expect(String(m.earnQuantity)).toBe("10000000000000001");
  });

  it("answers empty on a failed request instead of throwing", async () => {
    // The chip should vanish on a Counterparty hiccup, not break the page.
    mockFetch({}, false);
    expect(await fetchMempoolFairmints()).toEqual([]);
  });
});

describe("fetchMempoolFairminters", () => {
  it("fills in the two fields that only exist once mints happen", async () => {
    mockFetch({
      result: [{ tx_hash: "bb".repeat(32), params: { asset: "NEWCOIN", hard_cap: 1 } }],
    });
    const [fm] = await fetchMempoolFairminters();
    expect(fm.asset).toBe("NEWCOIN");
    expect(fm.earned_quantity).toBeNull();
    expect(fm.paid_quantity).toBeNull();
  });

  it("answers empty on a failed request", async () => {
    mockFetch({}, false);
    expect(await fetchMempoolFairminters()).toEqual([]);
  });
});
