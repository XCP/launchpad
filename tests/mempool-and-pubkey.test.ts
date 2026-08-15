import { describe, expect, it } from "vitest";
import { base64 } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1";

import { groupMintsByAddress } from "@/lib/mempool";
import { pubkeyFromBip322 } from "@/lib/bip322";
import type { MempoolMint } from "@/lib/api/counterparty";

/* ------------------------------------------------------------------ */
/* mempool grouping                                                    */
/* ------------------------------------------------------------------ */

const mint = (over: Partial<MempoolMint> = {}): MempoolMint => ({
  txHash: "aa".repeat(32),
  asset: "TESTCOIN",
  source: "1AAA",
  earnQuantity: "100000000000000", // 1,000,000 tokens
  paidQuantity: "1000000000", // 10 XCP
  divisible: true,
  ...over,
});

describe("groupMintsByAddress", () => {
  it("folds one address's mints into a single row", () => {
    // Ten rows for one person taking ten lots reads as ten people.
    const groups = groupMintsByAddress([
      mint({ txHash: "1" }),
      mint({ txHash: "2" }),
      mint({ txHash: "3" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.mints).toBe(3);
    expect(groups[0]!.tokensRaw).toBe(300_000_000_000_000n);
    expect(groups[0]!.xcpRaw).toBe(3_000_000_000n);
  });

  it("keeps one row per address, listing each asset once", () => {
    const groups = groupMintsByAddress([
      mint({ source: "1AAA", asset: "ALPHA", txHash: "1" }),
      mint({ source: "1AAA", asset: "BETA", txHash: "2" }),
      mint({ source: "1AAA", asset: "ALPHA", txHash: "3" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.assets).toEqual(["ALPHA", "BETA"]);
    expect(groups[0]!.mints).toBe(3);
  });

  it("sums exactly at magnitudes a double would round", () => {
    // 100 mints of the per-address cap is 1e16 — the hard cap itself.
    const many = Array.from({ length: 100 }, (_, i) =>
      mint({ txHash: String(i), earnQuantity: "100000000000000" }),
    );
    expect(groupMintsByAddress(many)[0]!.tokensRaw).toBe(10_000_000_000_000_000n);
  });

  it("ranks by XCP committed, descending", () => {
    const groups = groupMintsByAddress([
      mint({ source: "1SMALL", paidQuantity: "100000000" }),
      mint({ source: "1BIG", paidQuantity: "900000000" }),
      mint({ source: "1MID", paidQuantity: "500000000" }),
    ]);
    expect(groups.map((g) => g.source)).toEqual(["1BIG", "1MID", "1SMALL"]);
  });

  it("keeps ties in mempool order so the table doesn't shuffle between polls", () => {
    // A table that reorders under a stationary cursor looks broken even when
    // every number in it is right.
    const equal = [
      mint({ source: "1FIRST" }),
      mint({ source: "1SECOND" }),
      mint({ source: "1THIRD" }),
    ];
    expect(groupMintsByAddress(equal).map((g) => g.source)).toEqual([
      "1FIRST",
      "1SECOND",
      "1THIRD",
    ]);
  });

  it("returns nothing for no mints", () => {
    expect(groupMintsByAddress([])).toEqual([]);
  });
});

// The `mempoolTotals`/`summarize` suite that stood here tested a one-line
// summary sentence above the mempool page ("5 transactions in the mempool — 3
// new fairminters, and mints across 1 asset from 2 minters for 20 XCP"). The
// redesign in 51eb185 dropped that sentence — mints lead the page now, and the
// tabs carry their own counts — and took both functions with it, leaving these
// five importing names `@/lib/mempool` no longer exports. They have failed on
// main ever since. Removed rather than reimplemented: nothing renders that
// sentence, so restoring the functions would be writing code to satisfy a test
// rather than a reader.

/* ------------------------------------------------------------------ */
/* pubkey extraction                                                   */
/* ------------------------------------------------------------------ */

/** Serialize a witness stack the way BIP-322 encodes one: a varint count,
 *  then each item as varint length + bytes. */
function witness(items: Uint8Array[]): string {
  const parts: number[] = [items.length];
  for (const item of items) {
    parts.push(item.length);
    parts.push(...item);
  }
  return base64.encode(Uint8Array.from(parts));
}

const PRIV = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) % 251 || 7);
const PUB = secp256k1.getPublicKey(PRIV, true); // 33-byte compressed
const OTHER_PUB = secp256k1.getPublicKey(
  Uint8Array.from({ length: 32 }, (_, i) => (i + 99) % 251 || 11),
  true,
);
/** Any 72-byte blob stands in for the DER signature: this function reads the
 *  key, it does not verify the signature (verifyBip322 does that). */
const SIG = new Uint8Array(72).fill(0x30);

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("pubkeyFromBip322", () => {
  it("recovers the key from a p2pkh proof", () => {
    const address = btc.p2pkh(PUB).address!;
    expect(pubkeyFromBip322(address, witness([SIG, PUB]))).toBe(hex(PUB));
  });

  it("recovers the key from a p2wpkh proof", () => {
    const address = btc.p2wpkh(PUB).address!;
    expect(pubkeyFromBip322(address, witness([SIG, PUB]))).toBe(hex(PUB));
  });

  it("recovers the key from a p2sh-wrapped p2wpkh proof", () => {
    const address = btc.p2sh(btc.p2wpkh(PUB)).address!;
    expect(pubkeyFromBip322(address, witness([SIG, PUB]))).toBe(hex(PUB));
  });

  it("REJECTS a key that does not hash to the address it claims", () => {
    // The security property. This key is handed to Counterparty and embedded
    // in a multisig output as the source's own recovery key — accepting one
    // the wallet merely asserts would publish a key that recovers nothing.
    const address = btc.p2pkh(PUB).address!;
    expect(pubkeyFromBip322(address, witness([SIG, OTHER_PUB]))).toBeNull();
  });

  it("returns null for taproot rather than guessing which key to send", () => {
    // A p2tr address commits to the TWEAKED output key while the signable
    // one is the internal key; sending either would be a coin flip.
    const address = btc.p2tr(PUB.slice(1)).address!;
    expect(pubkeyFromBip322(address, witness([SIG, PUB]))).toBeNull();
  });

  it("refuses malformed proofs instead of throwing", () => {
    const address = btc.p2pkh(PUB).address!;
    expect(pubkeyFromBip322(address, "not base64 @@@")).toBeNull();
    expect(pubkeyFromBip322(address, witness([SIG]))).toBeNull(); // one item
    expect(pubkeyFromBip322(address, witness([SIG, PUB, PUB]))).toBeNull(); // three
    expect(pubkeyFromBip322(address, witness([SIG, PUB.slice(0, 20)]))).toBeNull();
    expect(pubkeyFromBip322("not-an-address", witness([SIG, PUB]))).toBeNull();
  });

  it("accepts the uncompressed key an old Counterwallet seed produces", () => {
    const uncompressed = secp256k1.getPublicKey(PRIV, false); // 65 bytes
    const address = btc.p2pkh(uncompressed).address!;
    expect(pubkeyFromBip322(address, witness([SIG, uncompressed]))).toBe(hex(uncompressed));
  });
});
