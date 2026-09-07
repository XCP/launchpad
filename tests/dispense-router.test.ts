/**
 * The dedicated Buy XCP router must get the same same-origin fallback as the
 * shared compose pipeline. It used to call Counterparty directly, so a
 * CORS-hidden rate limit escaped as the browser's raw "Failed to fetch" and
 * stopped the purchase before the wallet was asked to sign.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { hex, base64 } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { addressScriptPubKey } from "@xcp/wallet-sdk";
import { makeT } from "@/lib/i18n/t";

const SOURCE = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const DESTINATION = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const OTHER = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const t = makeT({});
const leg = { units: 1, btcSats: 1000, dispenser: {
  tx_hash: "a".repeat(64), source: DESTINATION, give_quantity: 100000000,
  give_remaining: 1000000000, satoshirate: 1000, price: 1000,
} };
function transaction(payment = 1000n, destination = DESTINATION, change = SOURCE) {
  const tx = new Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  tx.addInput({ txid: "11".repeat(32), index: 0, sequence: 0xfffffffd });
  tx.addOutput({ amount: payment, script: hex.decode(addressScriptPubKey(destination)) });
  tx.addOutput({ amount: 8000n, script: hex.decode(addressScriptPubKey(change)) });
  tx.addOutput({ amount: 0n, script: new Uint8Array([0x6a, 0x01, 0x00]) });
  return tx;
}
const raw = (tx = transaction()) => hex.encode(tx.toBytes(true, false));

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
      return Response.json({ result: { rawtransaction: raw() } });
    }) as unknown as typeof fetch);

    const { composeLeg } = await import(
      "@/app/[lang]/dispense/_lib/use-dispense-router"
    );
    const result = await composeLeg(
      SOURCE,
      leg,
      1,
      {},
      t,
    );

    expect(result).toBe(raw());
    expect(calls[0]).toContain(`${COUNTERPARTY_API_BASE}/addresses/${SOURCE}`);
    expect(calls[1]).toContain(`/api/cp/v2/addresses/${SOURCE}`);
  });

  it.each([0.1, 1.56])("preserves exact satoshi quantity and fractional fee %s", async fee => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url); return Response.json({ result: { rawtransaction: raw() } });
    }));
    const { composeLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    await composeLeg(SOURCE, leg, fee, { inputsSet: `${"11".repeat(32)}:0`, allowUnconfirmed: true }, t);
    const query = new URL(calls[0]!).searchParams;
    expect(query.get("quantity")).toBe("1000");
    expect(query.get("sat_per_vbyte")).toBe(String(fee));
    expect(query.get("allow_unconfirmed_inputs")).toBe("true");
    expect(query.get("inputs_set")).toBe(`${"11".repeat(32)}:0`);
  });

  it.each(["1e3", "1,000", "-1", "1.5", Number.MAX_SAFE_INTEGER + 1, Infinity])("rejects invalid direct payment %s before network", async value => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { composeLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    await expect(composeLeg(SOURCE, { ...leg, btcSats: value as number }, 1, {}, t)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -0.1])("rejects invalid fee %s before network", async fee => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { composeLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    await expect(composeLeg(SOURCE, leg, fee, {}, t)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["changed payment", () => raw(transaction(1001n))],
    ["changed recipient", () => raw(transaction(1000n, OTHER))],
    ["redirected change", () => raw(transaction(1000n, DESTINATION, OTHER))],
    ["malformed transaction", () => "deadbeef"],
  ] as const)("refuses Core's %s before signing", async (_name, fixture) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: { rawtransaction: fixture() } })));
    const { composeLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    await expect(composeLeg(SOURCE, leg, 1, {}, t)).rejects.toThrow();
  });

  it("refuses an accompanying PSBT for a different payment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: {
      rawtransaction: raw(), psbt: base64.encode(transaction(2000n).toPSBT()),
    } })));
    const { composeLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    await expect(composeLeg(SOURCE, leg, 1, {}, t)).rejects.toMatchObject({ code: "transaction_mismatch" });
  });

  it("allows signature bytes but refuses changed wallet outputs and sequences", async () => {
    const { signDispenseLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    const signed = transaction(); signed.updateInput(0, { finalScriptSig: new Uint8Array([0x01, 0x01]) });
    await expect(signDispenseLeg(raw(), SOURCE, leg, async () => raw(signed))).resolves.toBe(raw(signed));
    await expect(signDispenseLeg(raw(), SOURCE, leg, async () => raw(transaction(1001n)))).rejects.toMatchObject({ code: "transaction_mismatch" });
    const altered = transaction(); altered.updateInput(0, { sequence: 0 });
    await expect(signDispenseLeg(raw(), SOURCE, leg, async () => raw(altered))).rejects.toMatchObject({ code: "transaction_mismatch" });
  });

  it.each([
    { give_quantity: 50000000 }, { tx_hash: "b".repeat(64) },
    { satoshirate: 2000 }, { oracle_address: OTHER }, { give_remaining: 1 },
  ])("refuses stale dispenser terms %j", async changed => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: [{
      ...leg.dispenser, asset: "XCP", status: 0, oracle_address: null, ...changed,
    }] })));
    const { preflightLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    expect(await preflightLeg(leg, t)).not.toBeNull();
  });

  it("fails closed when dispenser state cannot be verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { preflightLeg } = await import("@/app/[lang]/dispense/_lib/use-dispense-router");
    expect(await preflightLeg(leg, t)).toBe("Could not refresh the quote. Try again.");
  });
});
