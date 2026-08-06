/**
 * BIP-322 "simple" signature verification for the two script types the XCP
 * Wallet extension produces: p2wpkh (ECDSA) and p2tr key-path (schnorr).
 *
 * The scheme: build a virtual `to_spend` transaction whose single output is
 * the signer's scriptPubKey and whose input commits to the tagged hash of the
 * message; then a virtual `to_sign` transaction spending it. The signature is
 * the serialized witness stack of that spend, base64-encoded. Verification =
 * computing the spend's sighash and checking the witness signature against
 * the address's own key material — so a passing signature proves control of
 * the address over exactly this message.
 *
 * Runs on the Cloudflare Worker: pure @scure/@noble, no Buffer, no wasm.
 */

import { base64 } from "@scure/base";
import { Address, OutScript, Transaction } from "@scure/btc-signer";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";

const TAG = "BIP0322-signed-message";

function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  const buf = new Uint8Array(tagHash.length * 2 + data.length);
  buf.set(tagHash, 0);
  buf.set(tagHash, tagHash.length);
  buf.set(data, tagHash.length * 2);
  return sha256(buf);
}

/** Serialized witness stack: varint count, then varint-length-prefixed items. */
function decodeWitnessStack(bytes: Uint8Array): Uint8Array[] {
  let pos = 0;
  const readVarint = (): number => {
    const first = bytes[pos++];
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const v = bytes[pos] | (bytes[pos + 1] << 8);
      pos += 2;
      return v;
    }
    throw new Error("witness item too large");
  };
  const count = readVarint();
  const stack: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const len = readVarint();
    if (pos + len > bytes.length) throw new Error("truncated witness stack");
    stack.push(bytes.subarray(pos, pos + len));
    pos += len;
  }
  if (pos !== bytes.length) throw new Error("trailing bytes in witness stack");
  return stack;
}

function buildToSignTx(message: string, scriptPubKey: Uint8Array): Transaction {
  // Version 0 is in btc-signer's default allowed set; its allowUnknownVersion
  // flag is NOT passed because the library's check inverts with it set.
  const txOpts = {
    version: 0,
    lockTime: 0,
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  };

  // to_spend: input commits to the message hash, output is the signer's script.
  const messageHash = taggedHash(TAG, new TextEncoder().encode(message));
  const scriptSig = new Uint8Array(2 + 32); // OP_0 PUSH32 <hash>
  scriptSig[0] = 0x00;
  scriptSig[1] = 0x20;
  scriptSig.set(messageHash, 2);

  const toSpend = new Transaction(txOpts);
  toSpend.addInput({
    txid: new Uint8Array(32),
    index: 0xffffffff,
    sequence: 0,
  });
  toSpend.addOutput({ script: scriptPubKey, amount: 0n });
  // Set after addOutput: a finalScriptSig marks the tx "signed" and blocks
  // further outputs; the force flag permits updating a signed input.
  toSpend.updateInput(0, { finalScriptSig: scriptSig }, true);

  // to_sign: spends to_spend's output 0 into an OP_RETURN.
  const toSign = new Transaction(txOpts);
  toSign.addInput({
    txid: toSpend.id,
    index: 0,
    sequence: 0,
    witnessUtxo: { script: scriptPubKey, amount: 0n },
  });
  toSign.addOutput({ script: Uint8Array.of(0x6a), amount: 0n });
  return toSign;
}

/**
 * Verify a BIP-322 simple signature. Returns false on any mismatch; throws
 * only for unsupported address types (so callers can distinguish "wrong
 * signature" from "can't verify this address kind").
 */
export function verifyBip322(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  const decoded = Address().decode(address);
  if (!decoded || (decoded.type !== "wpkh" && decoded.type !== "tr")) {
    throw new Error(`Unsupported address type for BIP-322: ${decoded?.type ?? "unknown"}`);
  }
  const scriptPubKey = OutScript.encode(decoded);

  let stack: Uint8Array[];
  try {
    stack = decodeWitnessStack(base64.decode(signatureBase64));
  } catch {
    return false;
  }

  const toSign = buildToSignTx(message, scriptPubKey);

  try {
    if (decoded.type === "wpkh") {
      if (stack.length !== 2) return false;
      const [sigWithType, pubkey] = stack;
      if (pubkey.length !== 33 || sigWithType.length < 9) return false;
      // The witness pubkey must be the one the address commits to.
      const pubkeyHash = ripemd160(sha256(pubkey));
      if (!bytesEqual(pubkeyHash, decoded.hash)) return false;
      const hashType = sigWithType[sigWithType.length - 1];
      const der = sigWithType.subarray(0, -1);
      // BIP-143: scriptCode for p2wpkh is the classic p2pkh script.
      const scriptCode = OutScript.encode({ type: "pkh", hash: decoded.hash });
      const digest = toSign.preimageWitnessV0(0, scriptCode, hashType, 0n);
      const sig = secp256k1.Signature.fromDER(der);
      return secp256k1.verify(sig.toCompactRawBytes(), digest, pubkey, { lowS: false });
    }

    // p2tr key-path: single-element witness, schnorr against the output key.
    if (stack.length !== 1) return false;
    const raw = stack[0];
    let sig: Uint8Array;
    let hashType: number;
    if (raw.length === 64) {
      sig = raw;
      hashType = 0x00; // SIGHASH_DEFAULT
    } else if (raw.length === 65 && raw[64] !== 0x00) {
      sig = raw.subarray(0, 64);
      hashType = raw[64];
    } else {
      return false;
    }
    const digest = toSign.preimageWitnessV1(0, [scriptPubKey], hashType, [0n]);
    return schnorr.verify(sig, digest, decoded.pubkey);
  } catch {
    return false;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
