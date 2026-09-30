import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { base64 } from "@scure/base";
import { p2pkh, p2wpkh, Transaction } from "@scure/btc-signer";
import { type ConnectionProof, legacyMessageHash } from "@xcp/wallet-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT as edit } from "@/app/api/launches/route";
import { getMetadataBucket } from "@/lib/metadata";
import { messageVerificationFor } from "@/lib/wallet/message-verification";

/**
 * The owner-edit fallback (no session): the page signs a challenge and the
 * route verifies it by the declared dialect. A P2PKH address must verify both
 * the classic 65-byte BIP-137 signature (XCP Wallet 0.14's legacy accounts)
 * and the two-item BIP-322 stack older wallets send, whatever the label; the
 * address check decides.
 */

vi.mock("@/lib/metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/metadata")>()),
  getMetadataBucket: vi.fn(),
  updateIndexedDescription: vi.fn(async () => {}),
  purgeMetadataCache: vi.fn(async () => {}),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { SESSION_SECRET: "owner-edit-test-secret-not-for-production" } }),
}));

const PRIV = new Uint8Array(32).fill(9);
const OTHER = new Uint8Array(32).fill(3);
const ASSET = "OWNEREDIT";
const NOW = 1_800_000_000;
const put = vi.fn();

const P2PKH = p2pkh(secp256k1.getPublicKey(PRIV, true)).address!;
const P2WPKH = p2wpkh(secp256k1.getPublicKey(PRIV, true)).address!;

function classic(message: string, priv = PRIV, headerBase = 31): string {
  const sig = secp256k1.sign(legacyMessageHash(message), priv, { prehash: false, lowS: true });
  return base64.encode(new Uint8Array([headerBase + sig.recovery!, ...sig.toCompactRawBytes()]));
}

/** The two-item BIP-322 legacy stack, built through btc-signer's own legacy sighash. */
function stack(message: string, priv = PRIV): string {
  const pubkey = secp256k1.getPublicKey(priv, true);
  const script = p2pkh(pubkey).script;
  const opts = { version: 0, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true };
  const tag = sha256(new TextEncoder().encode("BIP0322-signed-message"));
  const messageHash = sha256(new Uint8Array([...tag, ...tag, ...new TextEncoder().encode(message)]));
  const toSpend = new Transaction(opts);
  toSpend.addInput({ txid: new Uint8Array(32), index: 0xffffffff, sequence: 0 });
  toSpend.addOutput({ script, amount: 0n });
  toSpend.updateInput(0, { finalScriptSig: new Uint8Array([0x00, 0x20, ...messageHash]) }, true);
  const toSign = new Transaction(opts);
  toSign.addInput({ txid: toSpend.id, index: 0, sequence: 0 });
  toSign.addOutput({ script: Uint8Array.of(0x6a), amount: 0n });
  const digest = (
    toSign as unknown as { preimageLegacy(idx: number, script: Uint8Array, hashType: number): Uint8Array }
  ).preimageLegacy(0, script, 0x01);
  const der = secp256k1.sign(digest, priv, { prehash: false, lowS: true }).toDERRawBytes();
  const sig = new Uint8Array([...der, 0x01]);
  return base64.encode(new Uint8Array([2, sig.length, ...sig, pubkey.length, ...pubkey]));
}

async function sha256Hex(bytes: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

/** The edit panel's challenge, exactly as the route recomputes it. */
async function challenge(address: string) {
  const payload = JSON.stringify({ asset: ASSET, name: "", description: "gm", x: "", telegram: "", image_sha256: "" });
  const payloadHash = await sha256Hex(new TextEncoder().encode(payload));
  return `xcp-fun-edit\nasset:${ASSET}\naddress:${address}\nissued:${NOW}\npayload:${payloadHash}`;
}

function request(address: string, signature: string, verification?: ConnectionProof["verification"]) {
  const form = new FormData();
  form.set("asset", ASSET);
  form.set("name", "");
  form.set("description", "gm");
  form.set("x", "");
  form.set("telegram", "");
  form.set("address", address);
  form.set("signature", signature);
  form.set("issued", String(NOW));
  if (verification) form.set("verification", JSON.stringify(verification));
  return new Request("https://xcp.fun/api/launches", { method: "PUT", body: form, headers: { origin: "https://xcp.fun" } });
}

const BIP137 = { method: "BIP-137", format: "legacy_recoverable" } as const;
const BIP322_P2PKH = { method: "BIP-322", format: "p2pkh" } as const;
const LABELS = [["BIP-137", BIP137], ["BIP-322 p2pkh", BIP322_P2PKH], ["no label", undefined]] as const;

let owner = P2PKH;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  owner = P2PKH;
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).endsWith(`/assets/${ASSET}`) ? Response.json({ result: { owner } }) : Response.json({ result: [] })));
  vi.mocked(getMetadataBucket).mockResolvedValue(
    { put, get: vi.fn(async () => null) } as unknown as Awaited<ReturnType<typeof getMetadataBucket>>,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("owner edit on a P2PKH address", () => {
  it.each(LABELS)("accepts a classic 65-byte signature declared %s", async (_label, verification) => {
    const res = await edit(request(P2PKH, classic(await challenge(P2PKH)), verification));
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledWith(`j/${ASSET}`, expect.any(String), expect.anything());
  });

  it.each(LABELS)("accepts the legacy two-item BIP-322 stack declared %s", async (_label, verification) => {
    const res = await edit(request(P2PKH, stack(await challenge(P2PKH)), verification));
    expect(res.status).toBe(200);
  });

  it("refuses another key, a flipped compression flag, SegWit headers and another message", async () => {
    const message = await challenge(P2PKH);
    const signatures = [
      classic(message, OTHER),
      stack(message, OTHER),
      classic(message, PRIV, 27),
      classic(message, PRIV, 35),
      classic(message, PRIV, 39),
      classic(`${message}!`),
    ];
    for (const signature of signatures) {
      for (const [, verification] of LABELS) {
        expect((await edit(request(P2PKH, signature, verification))).status).toBe(401);
      }
    }
    expect(put).not.toHaveBeenCalled();
  });
});

describe("owner edit on a SegWit address", () => {
  it("keeps the declared dialect: a BIP-137 signature verifies only when declared", async () => {
    owner = P2WPKH;
    const signature = classic(await challenge(P2WPKH), PRIV, 39);
    expect((await edit(request(P2WPKH, signature, { method: "BIP-322", format: "p2wpkh" }))).status).toBe(401);
    expect((await edit(request(P2WPKH, signature, BIP137))).status).toBe(200);
  });
});

describe("messageVerificationFor", () => {
  const proof = (verification?: ConnectionProof["verification"], address = P2PKH): ConnectionProof => ({
    address,
    message: "m",
    signature: "s",
    ...(verification ? { verification } : {}),
  });

  it("declares what the connection proof for this address says", () => {
    expect(messageVerificationFor(P2PKH, proof(BIP137), undefined)).toEqual(BIP137);
    expect(messageVerificationFor(P2PKH, proof(BIP322_P2PKH), BIP137)).toEqual(BIP322_P2PKH);
  });

  it("falls back to the session's declared dialect without a matching labelled proof", () => {
    expect(messageVerificationFor(P2PKH, proof(BIP137, P2WPKH), undefined)).toBeUndefined();
    expect(messageVerificationFor(P2PKH, proof(undefined), BIP137)).toEqual(BIP137);
    expect(messageVerificationFor(P2PKH, null, BIP137)).toEqual(BIP137);
  });
});
