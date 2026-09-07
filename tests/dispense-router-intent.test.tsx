// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { addressScriptPubKey, invalidatePending, readPending } from "@xcp/wallet-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDispenseRouter } from "../apps/web/src/app/[lang]/dispense/_lib/use-dispense-router";

const SOURCE = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const DESTINATION = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const boundary = vi.hoisted(() => ({
  sign: vi.fn(), broadcast: vi.fn(), upstream: vi.fn(), utxos: vi.fn(),
  address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
}));
vi.mock("@xcp/wallet-sdk", async original => ({
  ...await original<typeof import("@xcp/wallet-sdk")>(),
  relayingFetch: boundary.upstream,
  withAddressTransactionLock: async (_address: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/esplora", () => ({ fetchAddressUtxos: boundary.utxos }));
vi.mock("@/lib/analytics", () => ({ trackTx: vi.fn() }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => ({
  address: boundary.address, signTransaction: boundary.sign, broadcastTransaction: boundary.broadcast,
}) }));

const leg = { units: 1, btcSats: 1000, dispenser: {
  tx_hash: "a".repeat(64), source: DESTINATION, give_quantity: 100000000,
  give_remaining: 1000000000, satoshirate: 1000, price: 1000,
} };
let live: typeof leg.dispenser & { asset: string; status: number; oracle_address: null };
function raw(payment = 1000n) {
  const tx = new Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  tx.addInput({ txid: "11".repeat(32), index: 0 });
  tx.addOutput({ amount: payment, script: hex.decode(addressScriptPubKey(DESTINATION)) });
  tx.addOutput({ amount: 8000n, script: hex.decode(addressScriptPubKey(SOURCE)) });
  return hex.encode(tx.toBytes(true, false));
}
let router: ReturnType<typeof useDispenseRouter>;
function Harness() { router = useDispenseRouter(100000); return <span>{router.phase}</span>; }
let root: Root;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  vi.clearAllMocks();
  boundary.address = SOURCE;
  localStorage.clear(); invalidatePending();
  live = { ...leg.dispenser, asset: "XCP", status: 0, oracle_address: null };
  boundary.utxos.mockResolvedValue([{ txid: "11".repeat(32), vout: 0, value: 10000, status: { confirmed: true } }]);
  boundary.upstream.mockImplementation(async (url: string) => url.includes("/compose/")
    ? Response.json({ result: { rawtransaction: raw() } })
    : Response.json({ result: [live] }));
  boundary.sign.mockImplementation(async (unsigned: string) => unsigned);
  boundary.broadcast.mockResolvedValue("broadcast-tx");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(() => root.render(<Harness />));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); });

describe("actual dispenser router signing and retry boundary", () => {
  it("checks changed vend size before re-signing a cached transaction", async () => {
    boundary.sign.mockRejectedValueOnce(new Error("User rejected"));
    await act(async () => { await router.start([leg], 0.1); });
    expect(router.phase).toBe("partial"); expect(router.legs[0]?.rawHex).toBe(raw());
    live.give_quantity = 50000000;
    await act(async () => { router.retry(0); });
    expect(boundary.sign).toHaveBeenCalledTimes(1);
    expect(boundary.upstream.mock.calls.filter(([url]) => url.includes("/compose/"))).toHaveLength(1);
    expect(boundary.broadcast).not.toHaveBeenCalled();
    expect(router.legs[0]?.error).toContain("route price changed");
  });

  it("does not broadcast when dispenser terms move while the wallet is signing", async () => {
    boundary.sign.mockImplementation(async (unsigned: string) => { live.satoshirate = 2000; return unsigned; });
    await act(async () => { await router.start([leg], 1.56); });
    expect(boundary.sign).toHaveBeenCalledTimes(1);
    expect(boundary.broadcast).not.toHaveBeenCalled();
    expect(router.phase).toBe("partial");
    expect(readPending()).toHaveLength(0);
  });

  it("does not broadcast a changed payment returned by the wallet", async () => {
    boundary.sign.mockResolvedValue(raw(999n));
    await act(async () => { await router.start([leg], 0.1); });
    expect(boundary.broadcast).not.toHaveBeenCalled();
    expect(router.legs[0]?.error).toContain("Transaction inputs, outputs or amounts changed");
  });

  it("checks the active account again before broadcasting", async () => {
    let resolve!: (value: string) => void;
    boundary.sign.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
    let pending!: Promise<void>;
    await act(async () => { pending = router.start([leg], 0.1); });
    expect(boundary.sign).toHaveBeenCalledTimes(1);
    boundary.address = DESTINATION;
    await act(() => root.render(<Harness />));
    await act(async () => { resolve(raw()); await pending; });
    expect(boundary.broadcast).not.toHaveBeenCalled();
    expect(router.legs[0]?.error).toContain("Wallet address changed");
  });

  it("completes the unchanged reviewed payment and registers it once", async () => {
    await act(async () => { await router.start([leg], 0.1); });
    expect(boundary.broadcast).toHaveBeenCalledWith(raw());
    expect(boundary.upstream.mock.calls.filter(([url]) => url.endsWith("/dispensers"))).toHaveLength(2);
    expect(router.phase).toBe("done");
    expect(readPending()).toHaveLength(1);
    expect(readPending()[0]).toMatchObject({ txid: "broadcast-tx", address: SOURCE, kind: "dispense" });
  });
});
