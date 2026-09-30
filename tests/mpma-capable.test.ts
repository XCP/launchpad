import { secp256k1 } from "@noble/curves/secp256k1";
import { p2pk, p2pkh, p2sh, p2tr, p2wpkh, p2wsh } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { MPMA_TAPROOT_SUPPORT_BLOCK, mpmaCapable } from "../scripts/lib/mpma.mjs";

const pub = secp256k1.getPublicKey(new Uint8Array(32).fill(5), true);
const ADDRESSES = {
  p2pkh: p2pkh(pub).address!,
  p2sh: p2sh(p2wpkh(pub)).address!,
  p2wpkh: p2wpkh(pub).address!,
  p2wsh: p2wsh(p2pk(pub)).address!,
  p2tr: p2tr(pub.slice(1)).address!,
};

describe("mpmaCapable", () => {
  it("activates with Core 11.4's mpma_taproot_support", () => {
    expect(MPMA_TAPROOT_SUPPORT_BLOCK).toBe(971_700);
  });

  it.each([MPMA_TAPROOT_SUPPORT_BLOCK - 1, 969_320])(
    "below the activation (tip %i) keeps 32-byte programs out, as Core's compose does",
    (tip) => {
      expect(mpmaCapable(ADDRESSES.p2pkh, tip)).toBe(true);
      expect(mpmaCapable(ADDRESSES.p2sh, tip)).toBe(true);
      expect(mpmaCapable(ADDRESSES.p2wpkh, tip)).toBe(true);
      expect(mpmaCapable(ADDRESSES.p2wsh, tip)).toBe(false);
      expect(mpmaCapable(ADDRESSES.p2tr, tip)).toBe(false);
    },
  );

  it.each([MPMA_TAPROOT_SUPPORT_BLOCK, MPMA_TAPROOT_SUPPORT_BLOCK + 1])(
    "from the activation (tip %i) takes P2TR and P2WSH recipients too",
    (tip) => {
      for (const address of Object.values(ADDRESSES)) expect(mpmaCapable(address, tip)).toBe(true);
    },
  );

  it("keeps today's split when the tip is unknown", () => {
    expect(mpmaCapable(ADDRESSES.p2tr, Number.NaN)).toBe(false);
    expect(mpmaCapable(ADDRESSES.p2wpkh, Number.NaN)).toBe(true);
  });
});
