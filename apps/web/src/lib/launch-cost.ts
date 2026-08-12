/**
 * What a launch costs in bitcoin, before anyone signs anything.
 *
 * The create page quoted only the fee RATE for a long time — "1 sat/vB" —
 * which understated the real requirement by roughly 27x and let a wallet that
 * looked funded fail to compose with an error about insufficient funds. Two
 * things were missing, and both are derived here rather than remembered.
 *
 * Everything is small-integer sat arithmetic on values bounded by a single
 * transaction, not raw asset quantities: a launch carries a few thousand
 * satoshi, nowhere near the range where a double stops naming one integer.
 */

/**
 * Bare-multisig chunking, from counterparty-core's own composer:
 *
 *   chunk_size = (33 * 2) - 1 - len(config.PREFIX) - 2 - 2
 *
 * Two pubkeys' worth of bytes, minus a length byte, the "CNTRPRTY" prefix,
 * and two sign/nonce bytes.
 */
const MULTISIG_CHUNK_BYTES = 33 * 2 - 1 - "CNTRPRTY".length - 2 - 2; // 53

/** core config.py: DEFAULT_MULTISIG_DUST_SIZE. Each data output must hold
 *  real bitcoin, because each one is a spendable output. */
const MULTISIG_DUST_SATS = 1_000;

/**
 * The fairminter payload minus its description, measured off PARTYKILLER's
 * real launch: 132 bytes of data for a 32-character description URL. Every
 * other field is fixed by XCP-69, so this part is identical on every launch
 * and only the description varies.
 */
const FAIRMINTER_FIXED_BYTES = 100;

/**
 * A launch transaction's size, measured off that same launch (weight 2136):
 * one input, three multisig data outputs, one change output. The previous
 * estimate of 200 treated a launch as close enough to a plain transfer — it
 * isn't, since the data outputs are most of the transaction.
 */
export const LAUNCH_TX_VBYTES = 534;

/**
 * Bitcoin carried in the data outputs.
 *
 * A fairminter's message is past the 80-byte OP_RETURN ceiling, so
 * Counterparty encodes it as bare multisig and the payload rides inside fake
 * pubkeys. Not spent — the outputs are 1-of-3 including the creator's own
 * key, which is what a wallet's recovery tool sweeps back — but it has to be
 * in the wallet on the day.
 *
 * A function rather than the 3,000 it evaluates to for every name in use
 * today: a constant is right until it isn't, and a longer description would
 * push the payload into a fourth output and silently understate the quote
 * again, which is the exact bug this exists to fix.
 */
export function launchDustSats(description: string): number {
  const payload = FAIRMINTER_FIXED_BYTES + description.length;
  return Math.ceil(payload / MULTISIG_CHUNK_BYTES) * MULTISIG_DUST_SATS;
}

/** Everything a launch needs on hand: miner fee plus the data-output dust. */
export function launchCostSats(feeRate: number, description: string): number {
  return feeRate * LAUNCH_TX_VBYTES + launchDustSats(description);
}
