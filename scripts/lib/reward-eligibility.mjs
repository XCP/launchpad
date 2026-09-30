/**
 * Which mints a reward batch may pay for.
 *
 * Entitlement is "the first N conforming mints globally", so a mint near the
 * tip is not yet a fact: a reorg or a Core re-parse can remove it or reorder
 * it, the indexer then rolls it back (apps/api/src/indexer/ledger.ts), and a
 * batch already frozen and paid from it cannot follow. A batch therefore only
 * reads mints with REWARD_CONFIRMATIONS confirmations, and refuses to run
 * until the cutoff is that deep.
 */

/** Confirmations a mint needs before a batch may count it. */
export const REWARD_CONFIRMATIONS = 6;

/**
 * The newest block a batch may read at chain tip `tip`. A mint in the tip
 * block has one confirmation, so six confirmations is `tip - 5` or older.
 */
export function settledThrough(tip) {
  return tip - (REWARD_CONFIRMATIONS - 1);
}

/**
 * The programme's canonical order, and the reason it is spelled out in full
 * here rather than trusted to arrive sorted: the tie-break has to be total and
 * stable or two runs could disagree about who is inside the cutoff. block,
 * then tx_index, then tx_hash -- the same order apps/api uses.
 *
 * One line with only validated integers interpolated, because the reward
 * script passes it to wrangler on a command line.
 */
export function eligibleMintsSql(cutoff, tip) {
  if (!Number.isInteger(cutoff) || cutoff < 1) throw new Error("cutoff must be a positive integer");
  if (!Number.isSafeInteger(tip) || tip < 1) throw new Error("tip must be a positive integer");
  return [
    "WITH eligible AS (",
    "SELECT m.tx_hash, m.source, m.launch_tx, m.block_index, m.tx_index",
    "FROM launch_mints m",
    "JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1",
    `WHERE m.block_index <= ${settledThrough(tip)}`,
    "ORDER BY m.block_index, COALESCE(m.tx_index, 0), m.tx_hash",
    `LIMIT ${cutoff})`,
    "SELECT tx_hash, source, launch_tx, block_index, COALESCE(tx_index, 0) AS tx_index",
    "FROM eligible ORDER BY block_index, tx_index, tx_hash",
  ].join(" ");
}
