import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "14RFPTKnBr6u38znGjKnsRc4pohpUt8ZmT";
const HASH = "ab".repeat(32);
const NOW = Date.parse("2026-09-08T08:00:00Z");
const CP = "https://api.counterparty.io:4000/v2";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const fetch = vi.fn(async () => new Response('{"result":[]}', { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const { nodeRoute } = await import("#api/read/node");
  const request = (path: string, init?: RequestInit) => nodeRoute.request(`https://api.xcp.fun/node${path}`, init);
  return { fetch, request };
}

describe("first-party read-only protocol fallback", () => {
  it("preserves raw integer digits, next_cursor and query encoding without touching a cache or forwarding credentials", async () => {
    const { fetch, request } = await fixture();
    const raw = '{"result":[{"quantity":10000000000000001}],"next_cursor":"a+b/c=="}';
    fetch.mockResolvedValue(new Response(raw, { headers: {
      "content-type": "application/json", "cache-control": "public,max-age=300", "set-cookie": "upstream-session=secret",
    } }));
    const path = `/v2/addresses/${ADDRESS}/balances?type=address&limit=1000&cursor=a%2Bb%2Fc%3D%3D`;
    const response = await request(path, { headers: { authorization: "Bearer secret", cookie: "session=private", "x-admin-token": "secret" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(raw);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${CP}${path.slice(3)}`, expect.objectContaining({
      method: "GET", cache: "no-store", redirect: "manual", headers: { accept: "application/json" }, signal: expect.any(AbortSignal),
    }));
  });

  it.each([
    "/v2/", "/v2/blocks/last", "/v2/blocks/966035",
    `/v2/addresses/${ADDRESS}/balances/XCP?type=address`,
    `/v2/addresses/${ADDRESS}/pools?verbose=true&limit=1000`,
    `/v2/addresses/${ADDRESS}/credits?limit=1000&cursor=44`,
    `/v2/addresses/${ADDRESS}/debits`, `/v2/addresses/${ADDRESS}/fairminters`,
    `/v2/addresses/${ADDRESS}/fairmints/EVOLVEDPEPE`, `/v2/addresses/${ADDRESS}/orders?status=open&limit=100`,
    `/v2/addresses/${ADDRESS}/dispensers`,
    `/v2/addresses/mempool?addresses=${ADDRESS}&event_name=DEBIT&verbose=true&limit=100`,
    "/v2/assets/EVOLVEDPEPE", "/v2/assets/EVOLVEDPEPE/fairminters?limit=100&verbose=true",
    "/v2/assets/EVOLVEDPEPE/issuances", "/v2/assets/EVOLVEDPE/holders?limit=1000&sort=quantity%3Adesc",
    "/v2/assets/XCP/dispensers?status=open&exclude_with_oracle=true&sort=price%3Aasc&limit=100",
    "/v2/fairminters?limit=1000&verbose=true", `/v2/fairminters/${HASH}`, `/v2/fairminters/${HASH}/fairmints?limit=1000`,
    `/v2/transactions/${HASH}`, `/v2/transactions/${HASH}/events?limit=1000`, `/v2/transactions/${HASH}/events/NEW_FAIRMINTER`,
    `/v2/bitcoin/transactions/${HASH}`, `/v2/utxos/${HASH}:0/balances?limit=1`,
    "/v2/mempool/events/NEW_FAIRMINTER?limit=500", "/v2/mempool/events/NEW_FAIRMINT?limit=500", "/v2/mempool/events/DISPENSE?limit=500",
    `/v2/mempool/transactions/${HASH}/events`, `/v2/orders/${HASH}?verbose=false`,
    "/v2/orders/EVOLVEDPEPE/XCP?status=open&limit=1000", "/v2/orders/EVOLVEDPEPE/XCP/matches?status=completed&limit=500",
    "/v2/pools/EVOLVEDPEPE/XCP", "/v2/pools/EVOLVEDPEPE/XCP/matches?limit=500&cursor=3175000",
    "/v2/pools/EVOLVEDPEPE/XCP/price_history?limit=1000&verbose=true",
    "/v2/pools/EVOLVEDPEPE/XCP/quote?quantity=10000000000000001",
    "/v2/pools/EVOLVEDPEPE/XCP/quote/deposit?quantity=10000000000000001", "/v2/pools/EVOLVEDPEPE/XCP/quote/withdraw?quantity=1",
  ])("admits the observed read operation %s", async path => {
    const { fetch, request } = await fixture();
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    `/v2/addresses/${ADDRESS}/compose/fairminter?asset=EVOLVEDPEPE&hard_cap=10000000000000001`,
    `/v2/addresses/${ADDRESS}/compose/fairmint?asset=EVOLVEDPEPE&quantity=100000000`,
    `/v2/addresses/${ADDRESS}/compose/pooldeposit/estimatexcpfees`,
    `/v2/addresses/${ADDRESS}/compose/poolwithdraw/estimatexcpfees`,
    `/v2/addresses/${ADDRESS}/compose/dispense?dispenser=${ADDRESS}&quantity=546&sat_per_vbyte=0.1&inputs_set=${HASH}%3A0`,
    `/v2/utxos/${HASH}:0/compose/detach?destination=${ADDRESS}&sat_per_vbyte=1&verbose=true`,
  ])("excludes wallet composition and fee estimate operation %s", async path => {
    const { fetch, request } = await fixture();
    expect((await request(path)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([`/address/${ADDRESS}/utxo`, `/tx/${HASH}/hex`])("excludes Electrs operation %s", async path => {
    const { fetch, request } = await fixture();
    const response = await request(`/bitcoin${path}`);
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])("excludes even correctly shaped broadcast requests (%s)", async method => {
    const { fetch, request } = await fixture();
    const signedHex = "01000000000000000000"; // Shape fixture only; never sent to a real node.
    const response = await request(`/v2/bitcoin/transactions?signedhex=${signedHex}`, { method });
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "?signedhex=abc", "?signedhex=xyzxyzxyzxyzxyzxyzxy", "?signedhex=00&signedhex=00", "?signedhex=01000000000000000000&private_key=secret"]) (
    "rejects malformed or expanded broadcast input %s before forwarding", async query => {
      const { fetch, request } = await fixture();
      expect((await request(`/v2/bitcoin/transactions${query}`, { method: "POST" })).status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["/v2/bitcoin/transactions?signedhex=01000000000000000000", "GET", 404],
    ["/v2/blocks/last", "POST", 405], ["/v2/blocks/last", "HEAD", 405], ["/v2/blocks/last", "PUT", 405],
    ["/v2/admin/reparse", "GET", 404], ["/v2/bitcoin/transactions/other", "POST", 404],
    ["/bitcoin/tx", "POST", 404], ["/bitcoin/blocks/tip/height", "GET", 404],
    ["/v2/assets/EVOLVEDPEPE?url=https://example.com", "GET", 400],
    [`/v2/addresses/${ADDRESS}/balances?private_key=secret`, "GET", 400],
    [`/v2/addresses/${ADDRESS}/compose/fairmint?asset=EVOLVEDPEPE&private_key=secret`, "GET", 404],
    [`/v2/addresses/${ADDRESS}/compose/arbitrary`, "GET", 404],
    ["/v2/assets/https%3A%2F%2Fevil.example", "GET", 404],
    ["/v2/assets/%252e%252e", "GET", 404], ["/v2/assets/%5Cevil", "GET", 404], ["/v2/assets/%ZZ", "GET", 404],
    ["/v2/fairminters?limit=1001", "GET", 400], ["/v2/fairminters?limit=1&limit=1000", "GET", 400],
    ["/v2/fairminters?limit=-1", "GET", 400], ["/v2/fairminters?cursor=" + "a".repeat(513), "GET", 400],
    [`/bitcoin/address/${ADDRESS}/utxo?limit=1`, "GET", 404],
  ])("rejects a non-contract request %s (%s)", async (path, method, expected) => {
    const { fetch, request } = await fixture();
    const response = await request(path, { method });
    expect(response.status).toBe(expected);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects POST with a request body before forwarding any input", async () => {
    const { fetch, request } = await fixture();
    const response = await request("/v2/blocks/last", { method: "POST", body: "private material" });
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers preflight locally with only that operation's method", async () => {
    const { fetch, request } = await fixture();
    const response = await request("/v2/blocks/last", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 404, 500, 503])("keeps upstream status %d, body and Retry-After visible without retries or negative caching", async status => {
    const { fetch, request } = await fixture();
    fetch.mockImplementation(async () => new Response('{"error":"original upstream failure"}', { status, headers: { "retry-after": "120" } }));
    const response = await request(`/v2/transactions/${HASH}`);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('{"error":"original upstream failure"}');
    expect(response.headers.get("retry-after")).toBe("120");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledOnce();
    await request("/v2/blocks/last");
    expect(fetch).toHaveBeenCalledTimes(2); // Only 429 establishes a cooldown.
  });

  it.each([["120", 120_000], ["Tue, 08 Sep 2026 08:02:00 GMT", 120_000], [null, 30_000]])(
    "honors upstream429 Retry-After %s across gateway callers while leaving the indexer independent", async (retryAfter, duration) => {
      const { fetch, request } = await fixture();
      fetch.mockResolvedValueOnce(new Response("node rate limit", { status: 429, headers: retryAfter === null ? {} : { "retry-after": retryAfter } }));
      const first = await request("/v2/blocks/last");
      expect(first.status).toBe(429);
      expect(await first.text()).toBe("node rate limit");
      expect(first.headers.get("retry-after")).toBe(retryAfter);
      vi.setSystemTime(NOW + 1_000);
      const second = await request(`/v2/addresses/${ADDRESS}/balances/XCP`);
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBe(String(duration / 1_000 - 1));
      expect(fetch).toHaveBeenCalledOnce();
      const { assertCounterpartyReadAllowed } = await import("#api/integrations/cooldown");
      expect(assertCounterpartyReadAllowed).not.toThrow();
      vi.setSystemTime(NOW + duration);
      expect((await request("/v2/blocks/last")).status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the longest concurrent refusal, even if a shorter one finishes later", async () => {
    const { fetch, request } = await fixture();
    const resolve: Array<(r: Response) => void> = [];
    fetch.mockImplementation(() => new Promise<Response>(r => { resolve.push(r); }));
    const first = request("/v2/blocks/last");
    const second = request(`/v2/transactions/${HASH}`);
    expect(resolve).toHaveLength(2);
    resolve[0]!(new Response(null, { status: 429, headers: { "retry-after": "120" } }));
    await first;
    resolve[1]!(new Response(null, { status: 429, headers: { "retry-after": "10" } }));
    await second;
    vi.setSystemTime(NOW + 119_000);
    expect((await request("/v2/blocks/last")).headers.get("retry-after")).toBe("1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses upstream redirects without following them or leaking an alternate host to the client", async () => {
    const { fetch, request } = await fixture();
    const cancel = vi.fn();
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: "https://example.com/private" } }));
    const response = await request("/v2/blocks/last");
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["caller", "deadline"])("cancels the upstream read when the %s aborts", async cancelledBy => {
    const { fetch, request } = await fixture();
    const caller = new AbortController();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    let upstreamSignal: AbortSignal | undefined;
    fetch.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      upstreamSignal = init!.signal as AbortSignal;
      upstreamSignal.addEventListener("abort", () => reject(upstreamSignal!.reason), { once: true });
    }));
    const pending = request("/v2/blocks/last", { signal: caller.signal });
    expect(fetch).toHaveBeenCalledOnce();
    if (cancelledBy === "caller") caller.abort();
    else deadline.abort(new DOMException("Read deadline expired", "TimeoutError"));
    expect((await pending).status).toBe(504);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not start an upstream read for an already cancelled caller", async () => {
    const { fetch, request } = await fixture();
    const caller = new AbortController();
    caller.abort();
    expect((await request("/v2/blocks/last", { signal: caller.signal })).status).toBe(504);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[new TypeError("network details"), 502], [new DOMException("timed out", "TimeoutError"), 504]])(
    "contains a transport failure with one bounded attempt", async (error, status) => {
      const { fetch, request } = await fixture();
      const timeout = vi.spyOn(AbortSignal, "timeout");
      fetch.mockRejectedValue(error);
      const response = await request("/v2/blocks/last");
      expect(response.status).toBe(status);
      expect(await response.text()).toBe('{"error":"Node temporarily unavailable"}');
      expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});
