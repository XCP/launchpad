import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("Mon, 07 Sep 2026 22:00:00 GMT");
const success = () => Response.json({ result: [], next_cursor: null });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("the API refuses reads during Counterparty's cooldown without waiting", () => {
  it.each([
    ["1", 1_000], ["120", 120_000], ["600", 600_000],
    ["Mon, 07 Sep 2026 22:02:00 GMT", 120_000],
    ["Monday, 07-Sep-26 22:02:00 GMT", 120_000],
    ["Mon Sep  7 22:02:00 2026", 120_000],
    [" 120 ", 120_000],
    [null, 30_000], ["", 30_000], ["1.5", 30_000], ["10garbage", 30_000], ["-1", 30_000],
  ])("honors %s and resumes only after %d milliseconds", async (header, delay) => {
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
      status: 429, headers: header === null ? {} : { "retry-after": header },
    })).mockImplementation(async () => success());
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    await expect(api.fetchPoolMatches("FEWGOODMAN", 0)).rejects.toThrow("HTTP 429");
    expect(cancel).toHaveBeenCalledOnce();
    // A different endpoint shares the same gate, rather than immediately
    // retrying the node while the original index pass still holds its lease.
    await expect(api.fetchOrderMatches("STOLEYERGIRL", 0)).rejects.toMatchObject({ name: "CounterpartyReadDeferred" });
    vi.setSystemTime(NOW + delay - 1);
    await expect(api.fetchPoolMatches("FEWGOODMAN", 0)).rejects.toMatchObject({ name: "CounterpartyReadDeferred" });
    expect(fetch).toHaveBeenCalledOnce();
    vi.setSystemTime(NOW + delay);
    await expect(api.fetchPoolMatches("FEWGOODMAN", 0)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["999999999999999999999999999", "9".repeat(400)])("never overflows a large server deadline into an early read (%s)", async header => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": header } }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    await expect(api.fetchPoolMatches("FEWGOODMAN", 0)).rejects.toThrow("HTTP 429");
    vi.setSystemTime(NOW + 365 * 86_400_000);
    await expect(api.fetchOrderMatches("FEWGOODMAN", 0)).rejects.toMatchObject({ name: "CounterpartyReadDeferred", retryAt: Infinity });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses HTTP's rolling fifty-year rule for obsolete two-digit years", async () => {
    const { retryAfterDeadline } = await import("#api/integrations/cooldown");
    expect(retryAfterDeadline("Thursday, 01-Jan-70 00:00:00 GMT", NOW)).toBe(Date.UTC(2070, 0, 1));
    expect(retryAfterDeadline("Saturday, 01-Jan-77 00:00:00 GMT", NOW)).toBe(NOW);
  });

  it("records the refusal before rejected-body cleanup has finished", async () => {
    let finishCancel!: () => void;
    const cancel = vi.fn(() => new Promise<void>(resolve => { finishCancel = resolve; }));
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    const first = api.fetchPoolMatches("FEWGOODMAN", 0);
    const rejected = expect(first).rejects.toThrow("HTTP 429");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    await expect(api.fetchOrderMatches("FEWGOODMAN", 0)).rejects.toMatchObject({ name: "CounterpartyReadDeferred" });
    expect(fetch).toHaveBeenCalledOnce();
    finishCancel();
    await rejected;
  });

  it.each([false, true])("keeps the longest concurrent deadline regardless of response order (%s)", async shorterFirst => {
    const pending: Array<(response: Response) => void> = [];
    const fetch = vi.fn(() => new Promise<Response>(resolve => { pending.push(resolve); }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    const first = api.fetchPoolMatches("FEWGOODMAN", 0);
    const second = api.fetchOrderMatches("FEWGOODMAN", 0);
    const completed = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    vi.setSystemTime(NOW);
    pending[0]!(new Response(null, { status: 429, headers: { "retry-after": shorterFirst ? "10" : "120" } }));
    pending[1]!(new Response(null, { status: 429, headers: { "retry-after": shorterFirst ? "120" : "10" } }));
    await completed;
    vi.setSystemTime(NOW + 119_999);
    await expect(api.fetchPoolMatches("FEWGOODMAN", 0)).rejects.toMatchObject({ retryAt: NOW + 120_000 });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValue(success());
    vi.setSystemTime(NOW + 120_000);
    await expect(api.fetchPoolMatches("FEWGOODMAN", 0)).resolves.toEqual([]);
  });

  it("preserves known absence versus deferred or failed pool lookup", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    expect(await api.fetchPool("ABSENT")).toEqual({ known: true, pool: null });
    expect(await api.fetchPool("FEWGOODMAN")).toEqual({ known: false, deferred: false });
    expect(await api.fetchPool("FEWGOODMAN")).toEqual({ known: false, deferred: true });
    await expect(api.fetchNewestOrderMatchBlock("FEWGOODMAN", true)).rejects.toMatchObject({ name: "CounterpartyReadDeferred" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("holds at most two permits until response bodies are consumed", async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }));
    });
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    const work = Promise.all(Array.from({ length: 8 }, (_, i) => api.fetchPoolMatches(`ASSET${i}`, 0)));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    // Headers have arrived, but unread bodies still occupy both permits.
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 8; i++) {
      await vi.waitFor(() => expect(controllers.length).toBeGreaterThan(i));
      active--;
      controllers[i]!.enqueue(new TextEncoder().encode('{"result":[],"next_cursor":null}'));
      controllers[i]!.close();
    }
    expect(await work).toEqual(Array.from({ length: 8 }, () => []));
    expect(peak).toBe(2);
  });

  it("rejects queued reads when an admitted response establishes cooldown", async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetch = vi.fn(() => new Promise<Response>(resolve => { pending.push(resolve); }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    const work = Promise.allSettled(Array.from({ length: 8 }, (_, i) => api.fetchPoolMatches(`ASSET${i}`, 0)));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    pending[0]!(new Response(null, { status: 429, headers: { "retry-after": "600" } }));
    pending[1]!(success());
    const results = await work;
    expect(results.filter(result => result.status === "rejected" && result.reason.name === "CounterpartyReadDeferred")).toHaveLength(6);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("includes admission in the existing timeout and removes expired queued reads", async () => {
    const timeouts: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      timeouts.push(controller);
      return controller.signal;
    });
    const pending: Array<(response: Response) => void> = [];
    const fetch = vi.fn(() => new Promise<Response>(resolve => { pending.push(resolve); }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("#api/integrations/counterparty");
    const work = Array.from({ length: 3 }, (_, i) => api.fetchPoolMatches(`ASSET${i}`, 0));
    const done = Promise.allSettled(work);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    timeouts[2]!.abort(new DOMException("Read budget expired", "TimeoutError"));
    pending[0]!(success());
    pending[1]!(success());
    const results = await done;
    expect(results[2]).toMatchObject({ status: "rejected", reason: { name: "TimeoutError" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls).toEqual([[15_000], [15_000], [15_000]]);
    timeout.mockRestore();
  });
});
