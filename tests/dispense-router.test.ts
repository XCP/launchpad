/**
 * The dedicated Buy XCP router must get the same same-origin fallback as the
 * shared compose pipeline. It used to call Counterparty directly, so a
 * CORS-hidden rate limit escaped as the browser's raw "Failed to fetch" and
 * stopped the purchase before the wallet was asked to sign.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

beforeEach(() => {
  vi.resetModules();
  installStorage();
});

afterEach(() => vi.unstubAllGlobals());

describe("Buy XCP compose", () => {
  it("retries a failed direct request through the same-origin relay", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      calls.push(String(url));
      if (calls.length === 1) throw new TypeError("Failed to fetch");
      return Response.json({ result: { rawtransaction: "deadbeef" } });
    }) as unknown as typeof fetch);

    const { composeLeg } = await import(
      "@/app/dispense/_lib/use-dispense-router"
    );
    const raw = await composeLeg(
      "bc1qnativewitnessaddress",
      {
        units: 1,
        btcSats: 1_000,
        dispenser: {
          tx_hash: "a".repeat(64),
          source: "1CounterpartyXXXXXXXXXXXXXXXUWLpVr",
          give_quantity: 100_000_000,
          give_remaining: 100_000_000,
          satoshirate: 1_000,
          price: 1_000,
        },
      },
      1,
      {},
    );

    expect(raw).toBe("deadbeef");
    expect(calls[0]).toContain(`${COUNTERPARTY_API_BASE}/addresses/bc1q`);
    expect(calls[1]).toContain("/api/cp/v2/addresses/bc1q");
  });
});
