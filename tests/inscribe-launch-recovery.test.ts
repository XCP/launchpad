// @vitest-environment happy-dom
import { secp256k1 } from "@noble/curves/secp256k1";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { taprootTweakPrivKey } from "@scure/btc-signer/utils.js";
import { type CommitAndRevealParams, WalletSdkError } from "@xcp/wallet-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BURN_ADDRESS, txidFromRawTx } from "@/lib/inscriber";
import { inscribeLaunch, resumeInscribeLaunch } from "@/lib/inscribe-launch";
import { loadPendingReveal } from "@/lib/pending-reveal";
import { BITCOIN_API_BASE, COUNTERPARTY_API_BASE } from "@/lib/constants";

/**
 * The stranded-commit window: the commit is broadcast and the reveal is not.
 * A throwaway Taproot key stands in for the wallet, signing exactly as the
 * regtest does (key path for the commit, the tweaked key on the envelope leaf
 * for the reveal).
 */

const priv = secp256k1.utils.randomPrivateKey();
const internalKey = secp256k1.getPublicKey(priv, true).slice(1);
const ADDRESS = btc.p2tr(internalKey).address!;
const tweaked = taprootTweakPrivKey(priv);

const parent = new btc.Transaction({ allowUnknownInputs: true });
parent.addInput({ txid: new Uint8Array(32).fill(1), index: 0 });
parent.addOutputAddress(ADDRESS, 200_000n);

let commitStatus: number;
let outspend: { spent: boolean; txid?: string };
let broadcasts: string[];

const signPsbt = vi.fn(async (psbtHex: string) => {
  const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex), { allowUnknownOutputs: true });
  if (tx.getInput(0).tapLeafScript?.length) {
    tx.signIdx(tweaked, 0, [btc.SigHash.ALL]);
  } else {
    tx.updateInput(0, { tapInternalKey: internalKey });
    tx.signIdx(priv, 0, [btc.SigHash.ALL]);
  }
  return hex.encode(tx.toPSBT());
});
const broadcast = vi.fn(async (raw: string) => {
  broadcasts.push(raw);
  return txidFromRawTx(raw);
});
const signCommitAndReveal = vi.fn(async (params: CommitAndRevealParams) => {
  expect(broadcast).not.toHaveBeenCalled();
  return { commit: await signPsbt(params.commitPsbt), reveal: await signPsbt(params.revealPsbt) };
});

const launch = (extra: Partial<Parameters<typeof inscribeLaunch>[0]> = {}) => inscribeLaunch({
  asset: "STRANDED",
  lpAsset: "A95500000000000001",
  startBlock: 970_000,
  softCapDeadlineBlock: 971_000,
  imageData: new Uint8Array(64).fill(7),
  mimeType: "image/webp",
  feeRate: 2,
  description: "https://xcp.fun/STRANDED.json",
  address: ADDRESS,
  signPsbt,
  broadcast,
  onStep: () => {},
  ...extra,
});
const resume = () => resumeInscribeLaunch({ record: loadPendingReveal(ADDRESS)!, signPsbt, broadcast, onStep: () => {} });
const revealSpends = (raw: string) => {
  const input = btc.Transaction.fromRaw(hex.decode(raw), { allowUnknownOutputs: true, disableScriptCheck: true }).getInput(0);
  return `${hex.encode(input.txid!)}:${input.index}`;
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  commitStatus = 200;
  outspend = { spent: false };
  broadcasts = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    if (url === `${BITCOIN_API_BASE}/address/${ADDRESS}/utxo`) {
      return Response.json([{ txid: parent.id, vout: 0, value: 200_000, status: { confirmed: true } }]);
    }
    if (url.startsWith(`${COUNTERPARTY_API_BASE}/utxos/`)) return Response.json({ result: [], next_cursor: null });
    if (url === `${BITCOIN_API_BASE}/tx/${parent.id}/hex`) return new Response(hex.encode(parent.unsignedTx));
    if (/\/tx\/[0-9a-f]{64}\/status$/.test(url)) return new Response(commitStatus === 200 ? "{}" : "not found", { status: commitStatus });
    if (/\/tx\/[0-9a-f]{64}\/outspend\/0$/.test(url)) return Response.json(outspend);
    throw new Error(`unexpected fetch ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("two-step inscription launch", () => {
  it("keeps the envelope when the reveal prompt is cancelled, and finishes the launch from it", async () => {
    signPsbt.mockImplementationOnce(signPsbt.getMockImplementation()!).mockRejectedValueOnce(new Error("User rejected"));
    await expect(launch()).rejects.toThrow("User rejected");
    expect(broadcasts).toHaveLength(1);
    const commitTxid = txidFromRawTx(broadcasts[0]!);
    const record = loadPendingReveal(ADDRESS);
    expect(record).toMatchObject({
      address: ADDRESS, asset: "STRANDED", startBlock: 970_000, commitTxid, commitVout: 0,
      commitRawTx: broadcasts[0], recipient: BURN_ADDRESS, feeRate: 2,
      tapInternalKey: hex.encode(btc.TAPROOT_UNSPENDABLE_KEY),
    });
    expect(record!.revealRawTx).toBeUndefined();

    const { revealTxid } = await resume();
    expect(broadcasts).toHaveLength(2);
    expect(revealSpends(broadcasts[1]!)).toBe(`${commitTxid}:0`);
    expect(revealTxid).toBe(txidFromRawTx(broadcasts[1]!));
    expect(loadPendingReveal(ADDRESS)).toBeNull();
  });

  it("sends the kept commit first when it never reached the network", async () => {
    signPsbt.mockImplementationOnce(signPsbt.getMockImplementation()!).mockRejectedValueOnce(new Error("page closed"));
    await expect(launch()).rejects.toThrow();
    const commitRaw = broadcasts[0]!;
    broadcasts = [];
    commitStatus = 404;
    await resume();
    expect(broadcasts[0]).toBe(commitRaw);
    expect(revealSpends(broadcasts[1]!)).toBe(`${txidFromRawTx(commitRaw)}:0`);
  });

  it("asks nothing when the reveal already made it, and forgets the record", async () => {
    signPsbt.mockImplementationOnce(signPsbt.getMockImplementation()!).mockRejectedValueOnce(new Error("page closed"));
    await expect(launch()).rejects.toThrow();
    signPsbt.mockClear();
    outspend = { spent: true, txid: "ab".repeat(32) };
    expect(await resume()).toMatchObject({ revealTxid: "ab".repeat(32) });
    expect(signPsbt).not.toHaveBeenCalled();
    expect(broadcasts).toHaveLength(1);
    expect(loadPendingReveal(ADDRESS)).toBeNull();
  });

  it("refuses a kept record whose commit does not pay its envelope", async () => {
    signPsbt.mockImplementationOnce(signPsbt.getMockImplementation()!).mockRejectedValueOnce(new Error("page closed"));
    await expect(launch()).rejects.toThrow();
    const record = loadPendingReveal(ADDRESS)!;
    await expect(resumeInscribeLaunch({ record: { ...record, commitAmount: record.commitAmount + 1 }, signPsbt, broadcast, onStep: () => {} }))
      .rejects.toMatchObject({ code: "transaction_mismatch" });
    expect(broadcasts).toHaveLength(1);
  });

  it("leaves nothing kept once the reveal is broadcast", async () => {
    const { commitTxid } = await launch();
    expect(broadcasts.map(txidFromRawTx)[0]).toBe(commitTxid);
    expect(loadPendingReveal(ADDRESS)).toBeNull();
  });
});

describe("commit-and-reveal bundle", () => {
  it("signs both in one request before broadcasting either, reveal built on the unsigned commit's txid", async () => {
    const { commitTxid, revealTxid } = await launch({ signCommitAndReveal });
    expect(signCommitAndReveal).toHaveBeenCalledOnce();
    const params = signCommitAndReveal.mock.calls[0]![0];
    expect(params).toMatchObject({ source: ADDRESS, commitSighashType: 0x01, revealSighashType: 0x01 });
    const unsignedCommit = btc.Transaction.fromPSBT(hex.decode(params.commitPsbt));
    const revealInput = btc.Transaction.fromPSBT(hex.decode(params.revealPsbt), { allowUnknownOutputs: true }).getInput(0);
    expect(hex.encode(revealInput.txid!)).toBe(unsignedCommit.id);
    expect(revealInput.index).toBe(0);
    expect(unsignedCommit.id).toBe(commitTxid);
    expect(broadcasts.map(txidFromRawTx)).toEqual([commitTxid, revealTxid]);
    expect(revealSpends(broadcasts[1]!)).toBe(`${commitTxid}:0`);
    // The script-path witness: signature, envelope leaf, control block.
    const witness = btc.Transaction.fromRaw(hex.decode(broadcasts[1]!), { allowUnknownOutputs: true, disableScriptCheck: true })
      .getInput(0).finalScriptWitness!;
    expect(witness).toHaveLength(3);
    expect(hex.encode(witness[1]!)).toBe(loadPendingRevealScript(params.revealPsbt));
    expect(loadPendingReveal(ADDRESS)).toBeNull();
    expect(signPsbt).toHaveBeenCalledTimes(2); // both halves, by the bundle's own signer
  });

  it("keeps the signed reveal if the page dies between the two broadcasts, and resuming only sends it", async () => {
    broadcast.mockImplementationOnce(async (raw) => { broadcasts.push(raw); return txidFromRawTx(raw); })
      .mockRejectedValueOnce(new Error("network down"));
    await expect(launch({ signCommitAndReveal })).rejects.toThrow("network down");
    const record = loadPendingReveal(ADDRESS)!;
    expect(record.revealRawTx).toMatch(/^[0-9a-f]+$/);
    signPsbt.mockClear();
    await resume();
    expect(signPsbt).not.toHaveBeenCalled();
    expect(broadcasts.at(-1)).toBe(record.revealRawTx);
    expect(loadPendingReveal(ADDRESS)).toBeNull();
  });

  it("falls back to two prompts when the wallet refuses the bundle before signing", async () => {
    signCommitAndReveal.mockRejectedValueOnce(new WalletSdkError("capability", "no bundle"));
    await launch({ signCommitAndReveal });
    expect(signPsbt).toHaveBeenCalledTimes(2);
    expect(broadcasts).toHaveLength(2);
  });

  it("broadcasts nothing and keeps nothing when the bundle prompt is declined", async () => {
    signCommitAndReveal.mockRejectedValueOnce(new WalletSdkError("user_rejected", "User rejected"));
    await expect(launch({ signCommitAndReveal })).rejects.toThrow("User rejected");
    expect(broadcasts).toEqual([]);
    expect(loadPendingReveal(ADDRESS)).toBeNull();
  });
});

function loadPendingRevealScript(revealPsbt: string): string {
  const leaf = btc.Transaction.fromPSBT(hex.decode(revealPsbt), { allowUnknownOutputs: true }).getInput(0).tapLeafScript![0]!;
  return hex.encode(leaf[1].subarray(0, -1));
}
