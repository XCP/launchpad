/**
 * When a Counterparty read is retried through our own origin, and when it is
 * not.
 *
 * The whole point is the case with no status to inspect. A denial served
 * without CORS headers reaches script as a bare TypeError — the same thing a
 * dead network produces — so the decision to relay has to be made without
 * knowing which one happened. Getting that wrong in the safe direction means
 * relaying a genuine 404 forever; getting it wrong in the other means the
 * failure this exists to fix goes straight through.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

const CP = `${COUNTERPARTY_API_BASE}/addresses/bc1qexample/balances/XCP?type=address`;

function stub(handlers: Array<() => Response | Promise<Response>>) {
  const calls: string[] = [];
  let n = 0;
  const fn = (async (url: string | URL) => {
    calls.push(String(url));
    const handler = handlers[Math.min(n++, handlers.length - 1)]!;
    return handler();
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return calls;
}

const ok = (body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const status = (code: number) => () => new Response("", { status: code });

/** What a browser hands script for a response it refuses to expose — a Cloud
 *  Armor denial carrying no access-control-allow-origin. Indistinguishable
 *  from the network being gone, which is exactly the problem. */
const opaque = () => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => vi.unstubAllGlobals());

describe("a Counterparty read that cannot be read", () => {
  it("retries through our own origin and returns the answer", async () => {
    const calls = stub([opaque, ok({ result: [] })]);
    await expect(fetchJson(CP)).resolves.toEqual({ result: [] });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("/api/cp/v2/addresses/bc1qexample/balances/XCP?type=address");
  });

  it("keeps the query string, which carries the meaning", async () => {
    // ?type=address is what excludes UTXO-attached rows. Dropping it on the
    // relay would return a different balance, silently and plausibly.
    const calls = stub([opaque, ok({ result: [] })]);
    await fetchJson(CP);
    expect(calls[1]).toContain("?type=address");
  });

  it("relays a rate limit, which is about this caller and not the request", async () => {
    for (const code of [403, 429, 500, 503]) {
      const calls = stub([status(code), ok({ result: [] })]);
      await expect(fetchJson(CP)).resolves.toEqual({ result: [] });
      expect(calls, `status ${code}`).toHaveLength(2);
      vi.unstubAllGlobals();
    }
  });

  it("does not relay an answer that would be the same from anywhere", async () => {
    // A 404 is about the path, not about who asked. Retrying it from a second
    // address doubles the traffic to learn the same thing.
    for (const code of [400, 404]) {
      const calls = stub([status(code)]);
      await expect(fetchJson(CP)).rejects.toThrow(`HTTP ${code}`);
      expect(calls, `status ${code}`).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it("surfaces the relay's own failure rather than hiding it", async () => {
    // Both gone is a real outage and has to reach the caller. Swallowing it
    // into an empty result would render as "no balance" for someone who has one.
    stub([opaque, status(502)]);
    await expect(fetchJson(CP)).rejects.toThrow("HTTP 502");
  });
});

describe("everything that is not Counterparty", () => {
  it("fails as it always did, with no second attempt", async () => {
    // The relay only knows how to speak to one upstream. Sending it anything
    // else would be an open proxy wearing our own origin.
    const calls = stub([opaque]);
    await expect(fetchJson("https://example.com/thing.json")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
