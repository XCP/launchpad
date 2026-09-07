import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * How the Counterparty client paces itself against a node that throttles.
 *
 * These are regression tests for a measured failure, not hypotheticals. A full
 * production build issued 24,970 requests to satisfy 441 distinct reads — the
 * same eleven locales asking the same questions at once — and the node answered
 * almost all of them with 429. The build then went green anyway, because a
 * throttled pool read was indistinguishable from "this asset has no pool", and
 * ten of eleven locales shipped a /swap page announcing that nothing had ever
 * graduated while 129 live pools said otherwise.
 *
 * So: ask once, ask few at a time, wait together, and never let "we were not
 * allowed to ask" turn into a fact about the chain.
 */

/** Fresh module state per test — the coalescing map and the shared pause are
 *  module-level, which is the point of them. */
async function loadClient() {
  vi.resetModules();
  return import("@/lib/api/counterparty");
}

interface StubCall {
  url: string;
  startedAt: number;
}

/**
 * A fetch stub that records every call and tracks whether each response body
 * was cancelled, so the abandoned-body contract is observable.
 */
type Stub = ReturnType<typeof stubFetch>;

let installed: Stub | null = null;

/** The stub installed by the most recent `stubFetch`, so a handler can build
 *  responses that record against the recorder it is registered on. */
function currentStub(): Stub {
  if (!installed) throw new Error("no fetch stub installed");
  return installed;
}

function stubFetch(handler: (url: string, call: number) => Promise<Response> | Response) {
  const calls: StubCall[] = [];
  const cancelled: string[] = [];
  let inFlightNow = 0;
  let peak = 0;

  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url, startedAt: Date.now() });
    inFlightNow++;
    peak = Math.max(peak, inFlightNow);
    try {
      return await handler(url, calls.length - 1);
    } finally {
      inFlightNow--;
    }
  });

  vi.stubGlobal("fetch", fetchStub);

  const recorder = {
    calls,
    cancelled,
    get peak() {
      return peak;
    },
    /** A body whose cancellation is recorded against `url`. */
    body(url: string) {
      return {
        cancel: async () => {
          cancelled.push(url);
        },
      } as unknown as ReadableStream<Uint8Array>;
    },
  };

  installed = recorder;
  return recorder;
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function throttled(stub: Stub, url: string, retryAfterSeconds?: number): Response {
  const headers = new Headers();
  if (retryAfterSeconds !== undefined) headers.set("retry-after", String(retryAfterSeconds));
  const response = new Response(null, { status: 429, headers });
  Object.defineProperty(response, "body", { value: stub.body(url), configurable: true });
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  installed = null;
});

describe("coalescing identical reads", () => {
  it("asks the node once when many callers want the same thing at once", async () => {
    stubFetch(async () => {
      await new Promise((resume) => setTimeout(resume, 10));
      return ok({ result: { asset_a: "PEPECASH", asset_b: "XCP", reserve_a: "1", reserve_b: "2" } });
    });
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    // Eleven locales rendering the same page is exactly this shape.
    const results = await Promise.all(Array.from({ length: 11 }, () => fetchPool("PEPECASH")));

    expect(stub.calls).toHaveLength(1);
    expect(results.every((pool) => pool?.asset_a === "PEPECASH")).toBe(true);
  });

  it("keeps distinct paths distinct", async () => {
    stubFetch(async () => ok({ result: null }));
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    await Promise.all([fetchPool("AAA"), fetchPool("BBB"), fetchPool("CCC")]);

    expect(stub.calls).toHaveLength(3);
  });

  it("coalesces, and does not cache: a settled read is asked again", async () => {
    stubFetch(async () => ok({ result: null }));
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    await fetchPool("AAA");
    await fetchPool("AAA");

    // Freshness stays with `revalidate` and Next's data cache. Remembering an
    // answer here would serve a stale pool for the life of the isolate.
    expect(stub.calls).toHaveLength(2);
  });

  it("does not remember a failure", async () => {
    let attempt = 0;
    stubFetch(async () => {
      attempt++;
      if (attempt === 1) throw new Error("connection reset");
      return ok({ result: null });
    });
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    await fetchPool("AAA");
    const second = await fetchPool("AAA");

    expect(stub.calls).toHaveLength(2);
    expect(second).toBeNull();
  });
});

describe("the concurrency gate", () => {
  it("never exceeds its ceiling, however many callers arrive", async () => {
    stubFetch(async () => {
      await new Promise((resume) => setTimeout(resume, 5));
      return ok({ result: null });
    });
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    // Distinct assets, so coalescing cannot be what limits the concurrency.
    await Promise.all(Array.from({ length: 40 }, (_unused, index) => fetchPool(`ASSET${index}`)));

    expect(stub.calls).toHaveLength(40);
    // Measured against the live node: useful throughput collapses to zero
    // above two concurrent requests, so the request-time ceiling is four and
    // going wider is not a tuning question, it is a regression.
    expect(stub.peak).toBeLessThanOrEqual(4);
  });
});

describe("a throttle is not an answer", () => {
  it("throws a distinguishable error once the retries are spent", async () => {
    stubFetch(async (url) => throttled(currentStub(), url, 0));
    const stub = currentStub();
    const { fetchPool, CounterpartyThrottled } = await loadClient();

    await expect(fetchPool("PEPECASH")).rejects.toBeInstanceOf(CounterpartyThrottled);
    // One attempt plus two retries at request time.
    expect(stub.calls).toHaveLength(3);
  });

  it("refuses to report a throttled pool read as no pool", async () => {
    stubFetch(async (url) => throttled(currentStub(), url, 0));
    const { fetchPool } = await loadClient();

    // The bug this file exists for: `catch { return null }` here is what put
    // "No launches have graduated yet" onto ten prerendered locales.
    await expect(fetchPool("PEPECASH")).rejects.toThrow(/429/);
  });

  it("still reports a genuine absence as absence", async () => {
    stubFetch(async () => ok({ result: null }));
    const { fetchPool } = await loadClient();

    expect(await fetchPool("NOSUCHPOOL")).toBeNull();
  });

  it("still absorbs an ordinary failure rather than breaking the page", async () => {
    stubFetch(async () => new Response(null, { status: 500 }));
    const { fetchPool } = await loadClient();

    expect(await fetchPool("PEPECASH")).toBeNull();
  });

  it("releases the body of every response it gives up on", async () => {
    stubFetch(async (url) => throttled(currentStub(), url, 0));
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    await fetchPool("PEPECASH").catch(() => undefined);

    // Three abandoned responses, three released connections. A Worker holds
    // six outbound slots; an uncancelled body keeps one until collection.
    expect(stub.cancelled).toHaveLength(3);
  });

  it("recovers when the node relents", async () => {
    let attempt = 0;
    stubFetch(async (url) => {
      attempt++;
      if (attempt === 1) return throttled(currentStub(), url, 0);
      return ok({ result: { asset_a: "XCP", asset_b: "PEPECASH", reserve_a: "9", reserve_b: "9" } });
    });
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    const pool = await fetchPool("PEPECASH");

    expect(pool?.reserve_a).toBe("9");
    expect(stub.calls).toHaveLength(2);
  });
});

describe("the pause is shared", () => {
  it("holds back unrelated reads too, because 429 is about the client", async () => {
    let throttledAt = 0;
    stubFetch(async (url, index) => {
      // Only the very first read is throttled, and it asks for a full second.
      if (index === 0) {
        throttledAt = Date.now();
        return throttled(currentStub(), url, 1);
      }
      return ok({ result: null });
    });
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    // The first read earns the pause. A read already in flight cannot be
    // called back, so what is under test is every read that starts after it.
    const first = fetchPool("FIRST");
    while (throttledAt === 0) await new Promise((resume) => setTimeout(resume, 5));

    await Promise.all([first, fetchPool("SECOND"), fetchPool("THIRD")]);

    const laterCalls = stub.calls.filter((call) => !call.url.includes("FIRST"));
    expect(laterCalls).toHaveLength(2);
    // Jitter halves the wait at most, so half the requested second is the
    // floor. Backing off only the throttled request is what let a wave of
    // readers re-earn the throttle the moment it was lifted.
    for (const call of laterCalls) {
      expect(call.startedAt - throttledAt).toBeGreaterThanOrEqual(400);
    }
  });

  it("lets unrelated reads through once the pause has elapsed", async () => {
    stubFetch(async (url, index) =>
      index === 0 ? throttled(currentStub(), url, 0) : ok({ result: null }),
    );
    const stub = currentStub();
    const { fetchPool } = await loadClient();

    await fetchPool("FIRST");
    await fetchPool("SECOND");

    // A zero-second Retry-After is a real instruction, not a missing one: the
    // pause expires immediately and nothing is left throttled by inertia.
    expect(stub.calls.length).toBeGreaterThanOrEqual(3);
  });
});
