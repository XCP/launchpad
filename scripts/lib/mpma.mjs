/**
 * Whether Counterparty can encode a destination inside an MPMA send.
 *
 * Until Core 11.4's `mpma_taproot_support` activates, MPMA's address table
 * holds fixed 21-byte packed addresses, and compose refuses anything whose
 * packed form exceeds 22 bytes (lib/messages/versions/mpma.py: "Address not
 * supported by MPMA send"). Packing is one version byte plus the payload, so a
 * 20-byte witness program packs to 21 and fits, while a 32-byte one packs to
 * 33 and does not. That excludes P2TR *and* P2WSH, not just taproot, which is
 * the trap: a bc1p check would pass and then break on the first batch with a
 * P2WSH recipient. This tests the packed length, like Core does.
 *
 * From the activation on, each table entry carries its own length and Core's
 * packer takes any address it can pack, so every destination fits.
 */

/** Mainnet activation of `mpma_taproot_support` (Core 11.4). */
export const MPMA_TAPROOT_SUPPORT_BLOCK = 971_700;

/**
 * `tipHeight` is the chain tip the send will be composed at. Core applies
 * `mpma_taproot_support` from the block after its tip, which is the earliest
 * block the send can land in, so a tip of 971,699 already takes every
 * destination. An unknown tip keeps the pre-activation split.
 */
export function mpmaCapable(address, tipHeight) {
  if (Number.isSafeInteger(tipHeight) && tipHeight + 1 >= MPMA_TAPROOT_SUPPORT_BLOCK) return true;
  const looksBech32 = /^(bc|tb|bcrt)1/i.test(address);
  if (!looksBech32) return true; // base58 P2PKH/P2SH pack to 21 bytes
  // A bech32 address packs to one version byte plus its witness program, so
  // the question is only how long that program is, which the data part's
  // length gives: strip the 6-character checksum and the 1-character witness
  // version, and every remaining character carries 5 bits.
  const data = address.slice(address.lastIndexOf("1") + 1);
  const programChars = data.length - 6 - 1;
  const programBytes = Math.floor((programChars * 5) / 8);
  return 1 + programBytes <= 22;
}
