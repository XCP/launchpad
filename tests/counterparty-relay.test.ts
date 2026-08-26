/**
 * When a Counterparty read is retried through our own origin, when it is not,
 * and how much of that any one browser is allowed.
 *
 * Two things here are easy to get backwards and expensive to get wrong.
 *
 * The first is that a rate limiter counts what it REJECTS, so the obvious
 * always-try-direct-first shape is what keeps the door shut: every read during
 * a throttle spends another rejected request against the same window.
 *
 * The second is that the relay has one egress IP for every visitor, so a
 * throttled page that simply redirects its full poll rate at us trades a limit
 * it hit alone for one it hits on everybody's behalf. A relay that is itself
 * rate limited is worth nothing to anyone, so background reads are budgeted
 * and user-driven ones are not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

const CP = `${COUNTERPARTY_API_BASE}/addresses/bc1qexample/balances/XCP?type=address`;

/** Module state (the throttle flag, the budget) is deliberately module-level,
 *  so each test needs its own instance or one test's throttle decides the
 *  next one's behaviour. */
async function load() {
  vi.resetModules();
  return {
    relay: await import("@/lib/counterparty-relay"),
    client: await import("@/lib/client"),
  };
}

/** A minimal localStorage, because the throttle flag and the budget are
 *  shared across tabs through it and node has none. */
function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

function stub(handlers: Array<() => Response | Promise<Response>>) {
  const calls: string[] = [];
  let n = 0;
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    calls.push(String(url));
    return handlers[Math.min(n++, handlers.length - 1)]!();
  }) as unknown as typeof fetch);
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
 *  from the network being gone, which is the whole problem. */
const opaque = () => {
  throw new TypeError("Failed to fetch");
};

beforeEach(() => installStorage());
afterEach(() => vi.unstubAllGlobals());

describe("a Counterparty read that cannot be read", () => {
  it("retries through our own origin and returns the answer", async () => {
    const calls = stub([opaque, ok({ result: [] })]);
    const { client } = await load();
    await expect(client.fetchJson(CP)).resolves.toEqual({ result: [] });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("/api/cp/v2/addresses/bc1qexample/balances/XCP?type=address");
  });

  it("keeps the query string, which carries the meaning", async () => {
    // ?type=address is what excludes UTXO-attached rows. Dropping it on the
    // relay would return a different balance, silently and plausibly.
    const calls = stub([opaque, ok({ result: [] })]);
    const { client } = await load();
    await client.fetchJson(CP);
    expect(calls[1]).toContain("?type=address");
  });

  it("relays a rate limit, which is about this caller and not the request", async () => {
    for (const code of [403, 429, 500, 503]) {
      installStorage();
      const calls = stub([status(code), ok({ result: [] })]);
      const { client } = await load();
      await expect(client.fetchJson(CP)).resolves.toEqual({ result: [] });
      expect(calls, `status ${code}`).toHaveLength(2);
      vi.unstubAllGlobals();
    }
  });

  it("does not relay an answer that would be the same from anywhere", async () => {
    // A 404 is about the path, not about who asked. Retrying it from a second
    // address doubles the traffic to learn the same thing.
    for (const code of [400, 404]) {
      installStorage();
      const calls = stub([status(code)]);
      const { client } = await load();
      await expect(client.fetchJson(CP)).rejects.toThrow(`HTTP ${code}`);
      expect(calls, `status ${code}`).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
});

describe("once we know we are throttled", () => {
  it("stops knocking on the door that is shut", async () => {
    // The point. A limiter counts what it rejects, so the doomed direct
    // attempt is not free — it is what stops the window draining.
    const calls = stub([opaque, ok({ result: [] }), ok({ result: [] })]);
    const { client } = await load();
    await client.fetchJson(CP); // learns it, via direct then relay
    calls.length = 0;
    await client.fetchJson(CP); // should go straight to the relay
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/cp/");
  });

  it("goes back to direct the moment one gets through", async () => {
    // The flag is a guess with a timer on it. A direct read that works is
    // better evidence than the timer, and waiting out the rest of it would
    // keep spending relay budget nobody needs.
    const calls = stub([opaque, ok({ a: 1 }), ok({ a: 1 }), ok({ a: 1 })]);
    const { client, relay } = await load();
    await client.fetchJson(CP);
    // Storage is what the next tab reads; clearing the flag has to reach it.
    localStorage.removeItem("xcpfun:cp-throttled-until");
    calls.length = 0;
    await client.fetchJson(CP);
    expect(calls[0]).toBe(CP);
    expect(relay.counterpartyRelay(CP)).toBeTruthy();
  });
});

describe("the relay has a capacity", () => {
  it("stops background reads once the budget is spent", async () => {
    // Eight per rolling minute, shared across tabs. Beyond that a poller
    // waits — otherwise one throttled browser pushes its whole poll rate at
    // an IP that is answering for every other visitor too.
    stub([opaque, ...Array(40).fill(ok({ result: [] }))]);
    const { client, relay } = await load();
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      await client.fetchJson(CP).catch((e: unknown) => {
        if (e instanceof relay.RelayBudgetExhausted) refused++;
      });
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("never turns away a read a person is waiting on", async () => {
    // Composing is exempt. Under a throttle the pollers stand down and the
    // buttons keep working, which is also what drains the window: the traffic
    // that caused it was never the buttons.
    stub([opaque, ...Array(40).fill(ok({ ok: true }))]);
    const { client, relay } = await load();
    for (let i = 0; i < 12; i++) await client.fetchJson(CP).catch(() => {});

    const res = await relay.relayingFetch(CP, 5_000, { essential: true });
    expect(res.ok).toBe(true);
  });

  it("refuses rather than inventing an empty answer", async () => {
    // Empty is a lie that renders. SWR holds the value it already had and
    // retries on its own schedule; a fabricated empty result would paint a
    // zero balance over a real one.
    stub([opaque, ...Array(40).fill(ok({ result: [] }))]);
    const { client, relay } = await load();
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await client.fetchJson(CP).catch((e: unknown) => e));
    }
    expect(results.some((r) => r instanceof relay.RelayBudgetExhausted)).toBe(true);
    expect(results.some((r) => r === null || r === undefined)).toBe(false);
  });
});

describe("everything that is not Counterparty", () => {
  it("fails as it always did, with no second attempt and no budget", async () => {
    // The relay only knows how to speak to one upstream. Sending it anything
    // else would be an open proxy wearing our own origin.
    const calls = stub([opaque]);
    const { client } = await load();
    await expect(client.fetchJson("https://example.com/thing.json")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
