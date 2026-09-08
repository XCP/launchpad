import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const TXID = "a1".repeat(32);
const LIVE_BASE = "https://api.counterparty.io:4000/v2";
const READ_BASE = "https://api.xcp.fun/node/v2";

// Exercise the installed SDK, including native broadcasting and composition.
// Only HTTP is mocked; these tests cannot connect a wallet or submit a real
// transaction. Direct live operations are intentional; ordinary page reads
// must use the index/read transport instead.
async function configuredSdk(browser = true) {
  vi.stubGlobal("window", browser ? {} : undefined);
  await import("@/lib/wallet/sdk-config");
  const sdk = await import("@xcp/wallet-sdk");
  sdk.configureWalletSdk({ storage: null });
  return sdk;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("indexed page reads and live wallet operations", () => {
  it.each([true, false])("keeps browser=%s SDK operations on the live node", async browser => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ result: null }));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk(browser);
    expect(sdk.getCounterpartyApiBase()).toBe(LIVE_BASE);
    await expect(sdk.fetchTransaction(TXID)).resolves.toBeNull();
    expect(requestedUrls(fetchMock)).toEqual([`${LIVE_BASE}/transactions/${TXID}?verbose=false`]);
  });

  it("routes routine fairminter compatibility reads through the first-party read API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ result: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await configuredSdk();
    const { fetchFairmintersByAsset } = await import("@/lib/api/counterparty");
    const { COUNTERPARTY_API_BASE, COUNTERPARTY_READ_API_BASE, BITCOIN_API_BASE } = await import("@/lib/constants");
    expect(COUNTERPARTY_API_BASE).toBe(LIVE_BASE);
    expect(COUNTERPARTY_READ_API_BASE).toBe(READ_BASE);
    expect(BITCOIN_API_BASE).toBe("https://api.counterparty.io:3000");
    await expect(fetchFairmintersByAsset("EVOLVEDPEPE")).resolves.toEqual([]);
    expect(requestedUrls(fetchMock)).toEqual([`${READ_BASE}/assets/EVOLVEDPEPE/fairminters?limit=100&verbose=true`]);
  });

  it("reads the ordinary indexed launch without reaching the raw or live node", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ result: null }));
    vi.stubGlobal("fetch", fetchMock);
    await configuredSdk();
    const { fetchIndexedLaunch } = await import("@/lib/api/launchpad-api");
    await expect(fetchIndexedLaunch("EVOLVEDPEPE")).resolves.toBeNull();
    expect(requestedUrls(fetchMock)).toEqual(["https://api.xcp.fun/v2/launches/EVOLVEDPEPE"]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("keeps exact live quote quantities and response digits beyond 2^53", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"result":{"quantity_in":10000000000000001,"quantity_out":9007199254740993}}'));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    const quote = await sdk.fetchPoolQuote("XCP", "EVOLVEDPEPE", "10000000000000001");
    expect(quote).toMatchObject({ quantity_in: "10000000000000001", quantity_out: "9007199254740993" });
    expect(requestedUrls(fetchMock)).toEqual([`${LIVE_BASE}/pools/XCP/EVOLVEDPEPE/quote?quantity=10000000000000001`]);
  });

  it("preserves live confirmed and pending wallet balance precision", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"result":[{"quantity":9007199254740993},{"quantity":7},{"utxo":"ignored:0","quantity":99}]}'))
      .mockResolvedValueOnce(new Response(`{"result":[{"event":"DEBIT","tx_hash":"${TXID}","params":{"address":"${ADDRESS}","asset":"XCP","quantity":9007199254740993}}]}`));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    await expect(sdk.fetchAssetBalance(ADDRESS, "XCP")).resolves.toBe(9007199254741000n);
    const pending = await sdk.fetchPendingDebits(ADDRESS);
    expect(pending.get("XCP")?.quantity).toBe(9007199254740993n);
    expect(requestedUrls(fetchMock)[0]).toBe(`${LIVE_BASE}/addresses/${ADDRESS}/balances/XCP?type=address`);
    const debit = new URL(requestedUrls(fetchMock)[1]);
    expect(debit.origin).toBe("https://api.counterparty.io:4000");
    expect(debit.pathname).toBe("/v2/addresses/mempool");
    expect(debit.searchParams.get("addresses")).toBe(ADDRESS);
    expect(debit.searchParams.get("event_name")).toBe("DEBIT");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429, 503])("retains the existing relay fallback for a live HTTP %s refusal", async status => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("unavailable", { status }));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    await expect(sdk.fetchAssetBalance(ADDRESS, "XCP")).rejects.toThrow();
    expect(requestedUrls(fetchMock)).toEqual([
      `${LIVE_BASE}/addresses/${ADDRESS}/balances/XCP?type=address`,
      `/api/cp/v2/addresses/${ADDRESS}/balances/XCP?type=address`,
    ]);
  });

  it("recovers a direct network failure through the existing browser relay", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fixture network failure"))
      .mockResolvedValueOnce(Response.json({ result: [{ quantity: 123 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    await expect(sdk.fetchAssetBalance(ADDRESS, "XCP")).resolves.toBe(123n);
    expect(requestedUrls(fetchMock)).toEqual([
      `${LIVE_BASE}/addresses/${ADDRESS}/balances/XCP?type=address`,
      `/api/cp/v2/addresses/${ADDRESS}/balances/XCP?type=address`,
    ]);
  });

  it("keeps submit-time application quote reads direct", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"result":{"quantity":9007199254740993}}'));
    vi.stubGlobal("fetch", fetchMock);
    await configuredSdk();
    const { fetchJson } = await import("@/lib/client");
    const url = `${LIVE_BASE}/pools/EVOLVEDPEPE/XCP/quote/withdraw?quantity=9007199254740993`;
    await expect(fetchJson(url)).resolves.toEqual({ result: { quantity: "9007199254740993" } });
    expect(requestedUrls(fetchMock)).toEqual([url]);
  });

  it("sends actual SDK composition to the live node and stops before signing on rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "fixture rejection" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    const signer = { address: ADDRESS, signTransaction: vi.fn(), broadcastTransaction: vi.fn() };
    await expect(sdk.composeAndBroadcast(signer, "fairmint", { asset: "EVOLVEDPEPE", quantity: "100000000000" }, { feeRate: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(requestedUrls(fetchMock)[0]);
    expect(url.origin).toBe("https://api.counterparty.io:4000");
    expect(url.pathname).toBe(`/v2/addresses/${ADDRESS}/compose/fairmint`);
    expect(url.searchParams.get("quantity")).toBe("100000000000");
    expect(url.searchParams.get("exclude_utxos_with_balances")).toBe("true");
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(signer.broadcastTransaction).not.toHaveBeenCalled();
  });

  it("keeps large signed transactions off the first-party gateway URL path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ result: TXID }));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    // Size/transport fixture, not a valid signed transaction. All fetches are mocked.
    const signedHexFixture = "ab".repeat(20_000);
    await expect(sdk.broadcastSignedTransaction(signedHexFixture)).resolves.toBe(TXID);
    expect(requestedUrls(fetchMock)).toEqual([`${LIVE_BASE}/bitcoin/transactions?signedhex=${signedHexFixture}`]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { accept: "application/json" } });
  });

  it("preserves the alternate Bitcoin broadcaster after direct broadcast failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "fixture unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(new Response(TXID));
    vi.stubGlobal("fetch", fetchMock);
    const sdk = await configuredSdk();
    const signedHexFixture = "01000000000000000000";
    await expect(sdk.broadcastSignedTransaction(signedHexFixture)).resolves.toBe(TXID);
    expect(requestedUrls(fetchMock)).toEqual([
      `${LIVE_BASE}/bitcoin/transactions?signedhex=${signedHexFixture}`,
      "https://mempool.space/api/tx",
    ]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: signedHexFixture });
  });
});
