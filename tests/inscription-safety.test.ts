import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hex } from "@scure/base";
import { p2tr, SigHash, Transaction, utils } from "@scure/btc-signer";
import { taprootTweakPrivKey } from "@scure/btc-signer/utils.js";
import { inscribeLaunch } from "../apps/web/src/lib/inscribe-launch";
import { addressToScriptPubKey, BURN_ADDRESS } from "../apps/web/src/lib/inscriber";
import { readPsbt, readTransaction } from "../apps/web/src/lib/transaction-verification";

// Offline transaction fixtures and a throwaway key; nothing reaches a node.
const key = hex.decode("01".padStart(64, "0"));
const internalKey = utils.pubSchnorr(key);
const address = p2tr(internalKey).address!;
function funding(value = 50000n, recipient = address) {
  const tx = new Transaction();
  tx.addInput({ txid: "11".repeat(32), index: 0 });
  tx.addOutputAddress(recipient, value);
  return { tx, utxo: { txid: tx.id, vout: 0, value: Number(value), status: { confirmed: true } } };
}
function sign(psbt: string) {
  const tx = readPsbt(psbt);
  if (tx.getInput(0).tapLeafScript) {
    // The create path puts the connected address's output key in the leaf.
    tx.signIdx(taprootTweakPrivKey(key), 0, [SigHash.ALL]);
  } else {
    tx.updateInput(0, { tapInternalKey: internalKey });
    tx.signIdx(key, 0, [SigHash.ALL]);
  }
  return hex.encode(tx.toPSBT());
}

let funds: ReturnType<typeof funding>[];
let balanceResponse: (outpoint: string) => Response;
let parentResponse: (txid: string) => Response;
let fetchMock: ReturnType<typeof vi.fn>;
let signMock: ReturnType<typeof vi.fn>;
let broadcast: ReturnType<typeof vi.fn>;
function options(feeRate = 1) {
  return {
    asset: "SAFELAUNCH", lpAsset: "A96000000000000001", startBlock: 966100,
    softCapDeadlineBlock: 967100, imageData: new Uint8Array([1, 2, 3]),
    mimeType: "image/png", feeRate, description: "https://xcp.fun/SAFELAUNCH.json",
    address, signPsbt: signMock, broadcast, onStep: vi.fn(),
  };
}
beforeEach(() => {
  funds = [funding()];
  balanceResponse = () => Response.json({ result: [], next_cursor: null });
  parentResponse = txid => new Response(hex.encode(funds.find(f => f.tx.id === txid)!.tx.toBytes(true, false)));
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith(`/address/${address}/utxo`)) return Response.json(funds.map(f => f.utxo));
    const balances = /\/utxos\/([^/]+)\/balances$/.exec(url.pathname);
    if (balances) {
      expect(url.searchParams.get("limit")).toBe("1");
      return balanceResponse(balances[1]!);
    }
    const parent = /\/tx\/([a-f0-9]{64})\/hex$/.exec(url.pathname);
    if (parent) return parentResponse(parent[1]!);
    throw new Error(`Unexpected request: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  signMock = vi.fn(async (psbt: string) => sign(psbt));
  broadcast = vi.fn(async (raw: string) => readTransaction(raw).id);
});
afterEach(() => vi.unstubAllGlobals());

describe("inscription funding and returned commit/reveal transactions", () => {
  it.each([0.1, 1, 1.56])("signs unchanged commit/reveal envelopes with fractional fee rate %s", async rate => {
    const result = await inscribeLaunch(options(rate));
    expect(signMock).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(result.commitTxid).toBe(readTransaction(broadcast.mock.calls[0]![0]).id);
    expect(result.revealTxid).toBe(readTransaction(broadcast.mock.calls[1]![0]).id);
    const commit = readTransaction(broadcast.mock.calls[0]![0]);
    const reveal = readTransaction(broadcast.mock.calls[1]![0]);
    expect(hex.encode(commit.getInput(0).txid!)).toBe(funds[0]!.tx.id);
    expect(reveal.getOutput(1).amount).toBe(546n);
    expect(hex.encode(reveal.getOutput(1).script!)).toBe(hex.encode(addressToScriptPubKey(BURN_ADDRESS)));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/balances?"))).toHaveLength(2);
  });

  it.each([404, 429, 503])("never treats HTTP%s as proof of balance-free funding", async status => {
    balanceResponse = () => new Response("unavailable", { status });
    await expect(inscribeLaunch(options())).rejects.toThrow("Could not verify funding UTXO balances");
    expect(signMock).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    { result: null, next_cursor: null }, { result: {} }, { result: [] },
    { result: [], next_cursor: 7 }, { error: "not ready", result: [], next_cursor: null },
  ])("rejects an ambiguous no-balance response %j", async body => {
    balanceResponse = () => Response.json(body);
    await expect(inscribeLaunch(options())).rejects.toThrow("Could not verify funding UTXO balances");
    expect(signMock).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled();
  });

  it("skips the larger asset-bearing UTXO and uses the verified clean one", async () => {
    funds = [funding(60000n), funding(50000n)];
    balanceResponse = outpoint => Response.json({ result: outpoint.startsWith(funds[0]!.tx.id)
      ? [{ asset: "TOKEN", quantity: 1, utxo: outpoint }] : [], next_cursor: null });
    await inscribeLaunch(options());
    expect(hex.encode(readPsbt(signMock.mock.calls[0]![0]).getInput(0).txid!)).toBe(funds[1]!.tx.id);
  });

  it("rejects a UTXO that gains balances during wallet approval", async () => {
    signMock.mockImplementationOnce(async (psbt: string) => {
      balanceResponse = () => Response.json({ result: [{ asset: "TOKEN", quantity: 1 }], next_cursor: null });
      return sign(psbt);
    });
    await expect(inscribeLaunch(options())).rejects.toThrow("now carries Counterparty balances");
    expect(signMock).toHaveBeenCalledTimes(1); expect(broadcast).not.toHaveBeenCalled();
  });

  it("stops when the post-signing balance recheck fails", async () => {
    signMock.mockImplementationOnce(async (psbt: string) => {
      balanceResponse = () => new Response("busy", { status: 503 });
      return sign(psbt);
    });
    await expect(inscribeLaunch(options())).rejects.toThrow("Could not verify funding UTXO balances");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["hash", "value", "script"])("rejects mismatched funding parent %s before signing", async mismatch => {
    if (mismatch === "hash") parentResponse = () => new Response(hex.encode(funding(50001n).tx.toBytes(true, false)));
    if (mismatch === "value") funds[0]!.utxo.value++;
    if (mismatch === "script") funds = [funding(50000n, BURN_ADDRESS)];
    await expect(inscribeLaunch(options())).rejects.toMatchObject({ code: "transaction_mismatch" });
    expect(signMock).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled();
  });

  it("refuses a changed commit output returned by the wallet before any broadcast", async () => {
    signMock.mockImplementationOnce(async (psbt: string) => {
      const tx = readPsbt(psbt);
      tx.updateOutput(0, { amount: tx.getOutput(0).amount! + 1n });
      return sign(hex.encode(tx.toPSBT()));
    });
    await expect(inscribeLaunch(options())).rejects.toMatchObject({ code: "transaction_mismatch" });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("refuses a changed reveal recipient, leaving only the already-broadcast commit", async () => {
    signMock.mockImplementationOnce(async (psbt: string) => sign(psbt));
    signMock.mockImplementationOnce(async (psbt: string) => {
      const tx = readPsbt(psbt);
      tx.updateOutput(1, { script: addressToScriptPubKey(address) });
      return sign(hex.encode(tx.toPSBT()));
    });
    await expect(inscribeLaunch(options())).rejects.toMatchObject({ code: "transaction_mismatch" });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
