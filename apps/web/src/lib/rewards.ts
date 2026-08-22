/**
 * The rewards programme's terms, in one place.
 *
 * Both /rewards and a profile quote what someone has earned, and a payout
 * script will one day pay it. Three copies of "100" would eventually
 * disagree, and the first anyone would notice is a number on the site that
 * doesn't match what landed in a wallet.
 */

/** Paid per mint TRANSACTION, whatever quantity it carries — because the
 *  Bitcoin fee being refunded is charged per transaction, not per lot. */
export const MINTS_PER_MINT = 100;

/** Ceiling on the whole programme: 10,000 x 100 = 1,000,000 MINTS. */
export const MINT_CAP = 10_000;

/** The seeded pool that prices the reward. */
export const POOL_MINTS = 1_000_000;
export const POOL_XCP = 1_000;

/** XCP per MINTS, implied by the pool ratio rather than quoted separately. */
export const MINTS_PRICE_XCP = POOL_XCP / POOL_MINTS;

/** Used only if the measured fee rollup is unavailable during a deploy or API
 *  outage. The rewards page normally uses the live observed median. */
export const FALLBACK_MINT_FEE_SATS = 273;
export const SATS_PER_XCP = 2_446;

export const BOUNTIES = [
  { place: "1st", xcp: 300 },
  { place: "2nd", xcp: 200 },
  { place: "3rd", xcp: 100 },
] as const;

/** MINTS earned for a given number of mint transactions. */
export const mintsEarned = (mints: number) => mints * MINTS_PER_MINT;
