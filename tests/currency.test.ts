import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrencyState } from "@/lib/currency";

const mocked = vi.hoisted(() => ({
  fetchFxRates: vi.fn(),
  subscribe: null as ((listener: () => void) => () => void) | null,
  readServer: null as (() => CurrencyState) | null,
}));

// Exercise the actual external store without a DOM renderer. Mounting and
// unmounting below use the subscription React receives; reads remain separate
// so a render cannot accidentally conceal a request or retry loop.
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (
    subscribe: (listener: () => void) => () => void,
    read: () => CurrencyState,
    readServer: () => CurrencyState,
  ) => {
    mocked.subscribe = subscribe;
    mocked.readServer = readServer;
    return read();
  },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchFxRates: mocked.fetchFxRates }));
vi.mock("@/lib/i18n/client", () => ({ useLocale: () => "en" }));

const PREF_KEY = "xcpfun:currency:v1";
const FX_KEY = "xcpfun:fx:v1";
const HALF_DAY = 12 * 60 * 60 * 1000;
const rates = (jpy = 150) => ({ base: "USD", date: "2026-09-07", rates: { JPY: jpy, EUR: 0.9 } });
let data: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let browser: { languages: string[]; language: string };
let page: { pathname: string };
let cleanups: (() => void)[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  mocked.fetchFxRates.mockReset().mockResolvedValue(rates());
  mocked.subscribe = null;
  mocked.readServer = null;
  data = new Map();
  storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  };
  browser = { languages: ["en-US"], language: "en-US" };
  page = { pathname: "/" };
  cleanups = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", browser);
  vi.stubGlobal("location", page);
  vi.stubGlobal("localStorage", storage);
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "America/New_York" } as Intl.ResolvedDateTimeFormatOptions);
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function load() {
  return import("@/lib/currency");
}

function mount(api: Awaited<ReturnType<typeof load>>) {
  api.useCurrency();
  const changed = vi.fn(() => { api.useCurrency(); });
  const cleanup = mocked.subscribe!(changed);
  cleanups.push(cleanup);
  return { changed, cleanup };
}

function cached(jpy: number, age = 0) {
  return JSON.stringify({ fetchedAt: Date.now() - age, date: "2026-09-04", rates: { JPY: jpy } });
}

function storageEvent(key: string | null, newValue: string | null) {
  const event = Object.assign(new Event("storage"), { key, newValue });
  window.dispatchEvent(event);
}

describe("currency preferences", () => {
  it("keeps passive locale navigation independent of Auto and preserves explicit USD", async () => {
    page.pathname = "/ja";
    const api = await load();
    mount(api);
    expect(api.useCurrency()).toMatchObject({ code: "USD", auto: true });
    expect(mocked.fetchFxRates).not.toHaveBeenCalled();

    api.setCurrency("USD");
    browser.languages = ["ja-JP"];
    page.pathname = "/fr";
    window.dispatchEvent(new Event("languagechange"));
    expect(api.useCurrency()).toMatchObject({ code: "USD", auto: false, detected: "JPY" });
    expect(mocked.fetchFxRates).not.toHaveBeenCalled();

    api.setCurrency("auto");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.useCurrency()).toMatchObject({ code: "JPY", auto: true, rate: 150 });
  });

  it("uses currency choices and fetched rates when storage is blocked", async () => {
    const blocked = () => { throw new Error("SecurityError"); };
    storage.getItem.mockImplementation(blocked);
    storage.setItem.mockImplementation(blocked);
    storage.removeItem.mockImplementation(blocked);
    const api = await load();
    mount(api);
    api.setCurrency("JPY");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.useCurrency()).toMatchObject({ code: "JPY", auto: false, rate: 150 });
    expect(api.useFiat()(2)).toBe("¥300");
    window.dispatchEvent(new Event("languagechange"));
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 150 });
    api.setCurrency("auto");
    expect(api.useCurrency()).toMatchObject({ code: "USD", auto: true });
  });

  it("retains an unsaved preference when reads work but the storage quota is full", async () => {
    data.set(PREF_KEY, "USD");
    storage.setItem.mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const api = await load();
    mount(api);
    api.setCurrency("JPY");
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("languagechange"));
    expect(data.get(PREF_KEY)).toBe("USD");
    expect(api.useCurrency()).toMatchObject({ code: "JPY", auto: false, rate: 150 });
  });

  it("applies cross-tab choices, FX updates, and storage.clear", async () => {
    const api = await load();
    const { changed } = mount(api);
    storageEvent(FX_KEY, cached(140));
    storageEvent(PREF_KEY, "JPY");
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 140 });
    storageEvent(FX_KEY, cached(155));
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 155 });
    storageEvent(null, null);
    expect(api.useCurrency()).toMatchObject({ code: "USD", auto: true });
    expect(changed).toHaveBeenCalledTimes(4);
    expect(mocked.fetchFxRates).not.toHaveBeenCalled();
  });
});

describe("FX refresh lifecycle", () => {
  it("fetches once for many subscribers, never during render, and waits on an incomplete fresh table", async () => {
    data.set(PREF_KEY, "JPY");
    mocked.fetchFxRates.mockResolvedValue({ base: "USD", date: "2026-09-07", rates: { EUR: 0.9 } });
    const api = await load();
    api.useCurrency();
    expect(mocked.fetchFxRates).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) mount(api);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 100; i++) api.useCurrency();
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(1);
    expect(api.useFxRate()).toEqual({ code: "USD", rate: 1 });
    expect(api.useCurrency().date).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(HALF_DAY - 1);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(1);
  });

  it("refreshes a persisted rate when an open tab reaches the 12-hour TTL", async () => {
    data.set(PREF_KEY, "JPY");
    data.set(FX_KEY, cached(140));
    const api = await load();
    mount(api);
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 140 });
    expect(mocked.fetchFxRates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HALF_DAY);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(1);
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 150 });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("rechecks an overdue rate on focus when background timers have not run", async () => {
    data.set(PREF_KEY, "JPY");
    data.set(FX_KEY, cached(140));
    const api = await load();
    mount(api);
    vi.setSystemTime(Date.now() + HALF_DAY + 1);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(1);
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 150 });
  });

  it("recovers from a first-load failure after a bounded retry delay", async () => {
    data.set(PREF_KEY, "JPY");
    mocked.fetchFxRates.mockResolvedValueOnce(null);
    const api = await load();
    mount(api);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.useFxRate()).toEqual({ code: "USD", rate: 1 });
    for (let i = 0; i < 100; i++) api.useCurrency();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(2);
    expect(api.useFxRate()).toEqual({ code: "JPY", rate: 150 });
  });

  it("keeps a usable old rate through a failed refresh and replaces it on retry", async () => {
    data.set(PREF_KEY, "JPY");
    data.set(FX_KEY, cached(140, HALF_DAY));
    mocked.fetchFxRates.mockRejectedValueOnce(new Error("offline"));
    const api = await load();
    mount(api);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.useCurrency()).toMatchObject({ rate: 140, date: "2026-09-04" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.useCurrency()).toMatchObject({ rate: 150, date: "2026-09-07" });
  });

  it("stops background refreshes with no subscribers and keeps SSR in dollars", async () => {
    data.set(PREF_KEY, "JPY");
    const api = await load();
    const { cleanup } = mount(api);
    cleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocked.readServer!()).toMatchObject({ code: "USD", rate: 1 });
    await vi.advanceTimersByTimeAsync(HALF_DAY);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(1);
    mount(api);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.fetchFxRates).toHaveBeenCalledTimes(2);
    api.setCurrency("USD");
    expect(vi.getTimerCount()).toBe(0);
  });
});
