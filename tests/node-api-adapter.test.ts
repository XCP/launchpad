import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/cp/[...path]/route";

const boundary = vi.hoisted(() => ({ request: vi.fn() }));
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => { boundary.request.mockReset(); vi.stubGlobal("fetch", boundary.request); });
afterEach(() => vi.unstubAllGlobals());

describe("same-origin emergency wallet read relay", () => {
  it("preserves oversized quantities, cursor bytes, query, and no-store semantics", async () => {
    const body = '{"result":[{"quantity":10000000000000001}],"next_cursor":991}';
    boundary.request.mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
    const response = await GET(new Request("https://xcp.fun/api/cp/v2/addresses/1abc/balances?cursor=9&limit=100", {
      headers: { cookie: "private-session", authorization: "private-auth" },
    }), context("v2", "addresses", "1abc", "balances"));
    expect(await response.text()).toBe(body);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.request.mock.calls[0][0]).toBe("https://api.counterparty.io:4000/v2/addresses/1abc/balances?cursor=9&limit=100");
    expect(boundary.request.mock.calls[0][1].headers).toEqual({ accept: "application/json" });
  });

  it("preserves a refusal and its retry minimum without making a second request", async () => {
    boundary.request.mockResolvedValue(new Response('{"error":"busy"}', { status: 429, headers: { "retry-after": "12" } }));
    const response = await GET(new Request("https://xcp.fun/api/cp/v2/"), context("v2"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.text()).toBe('{"error":"busy"}');
    expect(boundary.request).toHaveBeenCalledTimes(1);
  });

  it.each([["bitcoin"], ["v2", ".."], ["v2", "assets/PEPE"], ["v2", "assets\\PEPE"]])("rejects invalid namespace/path %j before transport", async (...path) => {
    const response = await GET(new Request("https://xcp.fun/api/cp/invalid"), context(...path));
    expect(response.status).toBe(404);
    expect(boundary.request).not.toHaveBeenCalled();
  });

  it("rejects broadcast POSTs, including unexpected bodies, before transport", async () => {
    const request = new Request("https://xcp.fun/api/cp/v2/bitcoin/transactions?signedhex=00aa", { method: "POST", body: "unexpected" });
    expect((await POST(request)).status).toBe(405);
    expect(boundary.request).not.toHaveBeenCalled();
  });

  it("rejects unrelated POSTs without contacting the API", async () => {
    const response = await POST(new Request("https://xcp.fun/api/cp/v2/assets/PEPE", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(boundary.request).not.toHaveBeenCalled();
  });

  it("reports transport failure as unavailable rather than an empty success", async () => {
    boundary.request.mockRejectedValue(new TypeError("connection lost"));
    const response = await GET(new Request("https://xcp.fun/api/cp/v2/"), context("v2"));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.request).toHaveBeenCalledTimes(1);
  });

  it("preserves compression metadata while streaming the original body", async () => {
    boundary.request.mockResolvedValue(new Response("compressed bytes", { headers: { "content-encoding": "gzip" } }));
    const response = await GET(new Request("https://xcp.fun/api/cp/v2/"), context("v2"));
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toBe("compressed bytes");
  });

  it("does not follow upstream redirects", async () => {
    boundary.request.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://other.invalid" } }));
    expect((await GET(new Request("https://xcp.fun/api/cp/v2/"), context("v2"))).status).toBe(502);
    expect(boundary.request.mock.calls[0][1].redirect).toBe("manual");
    expect(boundary.request).toHaveBeenCalledTimes(1);
  });
});
