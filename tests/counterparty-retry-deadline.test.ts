import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise pacing and retries; service-binding discovery has its
// own transport suite and must not introduce real module I/O into fake time.
vi.mock("@/lib/api/node", () => ({
  nodeApiFetch: (path: string, init: RequestInit) => fetch(`https://api.xcp.fun/node/v2${path}`, init),
}));

const NOW = Date.UTC(2026, 8, 7);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function ok() {
  return new Response(JSON.stringify({ result: null }));
}

function refused(header: string) {
  const response = new Response("busy", { status: 429, headers: { "retry-after": header } });
  const cancel = vi.spyOn(response.body!, "cancel");
  return { response, cancel };
}

/** Observe the actual public client, including coalescing, gate, and fetch. */
function record(handler: (url: string, index: number, init: RequestInit) => Promise<Response> | Response) {
  const starts: { url: string; at: number }[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init: RequestInit) => {
    starts.push({ url: String(input), at: Date.now() - NOW });
    return handler(String(input), starts.length - 1, init);
  }));
  return starts;
}

describe("the upstream retry deadline", () => {
  it.each([
    ["delay-seconds", "8"],
    ["HTTP-date", new Date(NOW + 8_000).toUTCString()],
    ["obsolete RFC 850 HTTP-date", "Monday, 07-Sep-26 00:00:08 GMT"],
    ["obsolete asctime HTTP-date", "Mon Sep  7 00:00:08 2026"],
  ])("waits the full %s minimum for the retry and unrelated reads", async (_label, header) => {
    const busy = refused(header);
    const starts = record((_url, index) => index === 0 ? busy.response : ok());
    const { fetchPool } = await import("@/lib/api/counterparty");
    const first = fetchPool("FIRST");
    await vi.advanceTimersByTimeAsync(0);
    const second = fetchPool("SECOND");
    await vi.advanceTimersByTimeAsync(7_999);
    expect(starts).toHaveLength(1);
    expect(busy.cancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(starts.slice(1).map((entry) => entry.at)).toEqual([8_000, 8_000]);
  });

  it("returns an error when the server minimum exceeds the runtime budget, retaining the shared cooldown", async () => {
    const busy = refused("60");
    const starts = record((_url, index) => index === 0 ? busy.response : ok());
    const { fetchPool } = await import("@/lib/api/counterparty");
    const first = fetchPool("FIRST").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(await first).toMatchObject({ name: "CounterpartyThrottled" });
    expect(busy.cancel).toHaveBeenCalledOnce();
    // A fallback caller must not start a new transport request during cooldown.
    await expect(fetchPool("FALLBACK")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await fetchPool("RECOVERED");
    expect(starts.map((entry) => entry.at)).toEqual([0, 60_000]);
  });

  it("retains the final exhausted response's deadline for later callers", async () => {
    const responses = [refused("0"), refused("0"), refused("60")];
    const starts = record((_url, index) => responses[index]?.response ?? ok());
    const { fetchPool } = await import("@/lib/api/counterparty");
    await expect(fetchPool("FIRST")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    await expect(fetchPool("FALLBACK")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(3);
    for (const { cancel } of responses) expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not let a concurrent transport failure shorten another request's server minimum", async () => {
    let failTransport!: (error: Error) => void;
    const starts = record((url, index) => {
      if (index === 0) return new Promise((_resolve, reject) => { failTransport = reject; });
      if (url.includes("BUSY") && index === 1) return refused("8").response;
      return ok();
    });
    const { fetchPool } = await import("@/lib/api/counterparty");
    const transport = fetchPool("TRANSPORT");
    const busy = fetchPool("BUSY");
    await vi.advanceTimersByTimeAsync(0);
    failTransport(new TypeError("connection reset"));
    await vi.advanceTimersByTimeAsync(7_999);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([transport, busy]);
    expect(starts.slice(2).every((entry) => entry.at >= 8_000)).toBe(true);
  });

  it("rechecks an extended shared deadline after an earlier timer wakes", async () => {
    let finishSecond!: (response: Response) => void;
    const starts = record((_url, index) => {
      if (index === 0) return refused("8").response;
      if (index === 1) return new Promise((resolve) => { finishSecond = resolve; });
      return ok();
    });
    const { fetchPool } = await import("@/lib/api/counterparty");
    const first = fetchPool("FIRST");
    const second = fetchPool("SECOND");
    await vi.advanceTimersByTimeAsync(1_000);
    finishSecond(refused("8").response);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(starts.slice(2).every((entry) => entry.at === 9_000)).toBe(true);
  });

  it("counts time spent on the first request against the retry budget", async () => {
    const busy = refused("8");
    const starts = record((_url, index) => index === 0
      ? new Promise((resolve) => setTimeout(() => resolve(busy.response), 8_000))
      : ok());
    const { fetchPool } = await import("@/lib/api/counterparty");
    const result = fetchPool("FIRST").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(1);
    expect(busy.cancel).toHaveBeenCalledOnce();
  });

  it("aborts a retry at the remaining runtime budget instead of giving it a fresh eight seconds", async () => {
    const starts = record((_url, index, init) => index === 0 ? refused("8").response
      : new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      }));
    const { fetchPool } = await import("@/lib/api/counterparty");
    // Running out of time must not turn into a false "this pool is absent".
    const result = fetchPool("AAA").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(starts.map((entry) => entry.at)).toEqual([0, 8_000]);
    expect(AbortSignal.timeout).toHaveBeenLastCalledWith(7_000);
  });

  it("counts waiting for a concurrency slot against the caller budget", async () => {
    const starts = record((_url, _index, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    const { fetchFairmintersByAsset } = await import("@/lib/api/counterparty");
    const results = Promise.all(Array.from({ length: 8 }, (_, index) =>
      fetchFairmintersByAsset(`ASSET${index}`).catch((error: unknown) => error)));
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await results).every((error) => error instanceof Error)).toBe(true);
    expect(starts.every((entry) => entry.at < 15_000)).toBe(true);
    expect(starts.some((entry) => entry.url.includes("ASSET4"))).toBe(false);
  });

  it("does not clamp a build's server minimum to ten seconds", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const starts = record((_url, index) => index === 0 ? refused("20").response : ok());
    const { fetchPool } = await import("@/lib/api/counterparty");
    const result = fetchPool("FIRST");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(starts.map((entry) => entry.at)).toEqual([0, 20_000]);
  });

  it("rejects a wait beyond the build's 180-second page budget", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const busy = refused("181");
    const starts = record(() => busy.response);
    const { fetchPool } = await import("@/lib/api/counterparty");
    await expect(fetchPool("FIRST")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(1);
    expect(busy.cancel).toHaveBeenCalledOnce();
  });

  it("still bounds build attempts when Retry-After is zero", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const starts = record(() => refused("0").response);
    const { fetchPool } = await import("@/lib/api/counterparty");
    await expect(fetchPool("FIRST")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(6);
  });

  it("does not overflow an enormous valid server delay into an early retry", async () => {
    const starts = record(() => refused("999999999999999999999999999999").response);
    const { fetchPool } = await import("@/lib/api/counterparty");
    await expect(fetchPool("FIRST")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(1);
  });

  it("interprets a future two-digit HTTP year using the rolling 50-year limit", async () => {
    // 2075 is less than 50 years ahead of the test clock; Date.parse's fixed
    // cutoff would read 1975 and incorrectly permit an immediate retry.
    const starts = record(() => refused("Tuesday, 01-Jan-75 00:00:00 GMT").response);
    const { fetchPool } = await import("@/lib/api/counterparty");
    await expect(fetchPool("FIRST")).rejects.toMatchObject({ name: "CounterpartyThrottled" });
    expect(starts).toHaveLength(1);
  });

  it.each(["0junk", "0.5", "0e5"])("does not parse malformed %s as a zero-second instruction", async (header) => {
    const starts = record((_url, index) => index === 0 ? refused(header).response : ok());
    const { fetchPool } = await import("@/lib/api/counterparty");
    const result = fetchPool("FIRST");
    await vi.advanceTimersByTimeAsync(124);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(starts.map((entry) => entry.at)).toEqual([0, 125]);
  });
});
