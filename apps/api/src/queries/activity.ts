/**
 * The sitewide tape: mints, trades and launches ordered by when they happened
 * rather than by which launch they belong to.
 *
 * Every other read in this worker is scoped — one launch, one address, one
 * pair. These three are the same tables asked the opposite question, which is
 * why they live in their own file: they share an ordering discipline (a stable
 * tiebreak, always, so pages cannot repeat or skip a row) that none of the
 * scoped queries need.
 *
 * Each ORDER BY here matches an index from migration 0021 column for column.
 * Adding a trailing sort term that the index does not carry silently converts
 * a bounded seek into a full scan, and D1 bills the difference — so if one of
 * these is edited, the index is part of the edit.
 */
import { one, q } from "#api/db";

/** Which venue an asset_events row came from, recovered from the identity the
 *  indexer minted for it. A book fill's event is `make_id(tx0, tx1)` — two
 *  64-char hashes joined by an underscore; everything else is a pool swap
 *  (a bare tx hash, or `tx#index` for the second fill of one transaction).
 *  Same predicate migration 0014 used to backfill `tx_hash`. */
const VENUE = `CASE
  WHEN length(e.event) = 129 AND substr(e.event, 65, 1) = '_' THEN 'book'
  ELSE 'pool'
END`;

export interface RecentMintRow {
  tx_hash: string;
  asset: string;
  source: string;
  block_index: number;
  earn_quantity: string;
  paid_quantity: string;
  divisible: number;
  /** The launch's phase, which is what says whether this mint became tokens,
   *  became a refund, or is still escrowed and undecided. */
  phase: string;
}

/** Every fairmint on the site, newest first. Conformance is filtered with
 *  `IS NOT 0` rather than `= 1` for the same reason getMintsBySource does:
 *  NULL means undecided, and a mint against a launch whose creation event has
 *  not been read yet is still a real thing that happened. */
export function listRecentMints(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecentMintRow[]> {
  return q<RecentMintRow>(
    db,
    `SELECT m.tx_hash, l.asset, m.source, m.block_index,
            m.earn_quantity, m.paid_quantity, l.divisible, l.phase
       FROM launch_mints m
       JOIN launches l ON l.tx_hash = m.launch_tx
      WHERE l.conforming IS NOT 0
      ORDER BY m.block_index DESC, m.tx_hash DESC
      LIMIT ?1 OFFSET ?2`,
    limit,
    offset,
  );
}

export interface RecentTradeRow {
  event: string;
  tx_hash: string | null;
  asset: string;
  address: string;
  block_index: number;
  token_delta: string;
  xcp_delta: string;
  kind: string;
  venue: string;
  divisible: number;
}

export interface RecentBurnRow {
  key: string;
  tx_hash: string;
  asset: string;
  source: string;
  destination: string;
  block_index: number;
  quantity: string;
}

/** Confirmed XCP-69 sends to the canonical burn address, newest first. */
export function listRecentBurns(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecentBurnRow[]> {
  return q<RecentBurnRow>(
    db,
    `SELECT key, tx_hash, asset, source, destination, block_index, quantity
       FROM token_burns
      ORDER BY block_index DESC, tx_index DESC, msg_index DESC, key DESC
      LIMIT ?1 OFFSET ?2`,
    limit,
    offset,
  );
}

/**
 * Every confirmed fill on the site, newest first — the tape the asset page
 * shows for one pair, unscoped.
 *
 * LEFT JOIN, and divisibility defaults to divisible. Every asset in this table
 * is one this site tracks, so the join should always land; if it somehow does
 * not, dropping the row would hide a real trade, whereas a wrong decimal place
 * on a rare orphan is visibly wrong and recoverable.
 */
export function listRecentTrades(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecentTradeRow[]> {
  return q<RecentTradeRow>(
    db,
    `SELECT e.event, e.tx_hash, e.asset, e.address, e.block_index,
            e.token_delta, e.xcp_delta, e.kind,
            ${VENUE} AS venue,
            COALESCE(l.divisible, 1) AS divisible
       FROM asset_events e
       LEFT JOIN launches l ON l.asset = e.asset
      WHERE e.primary_actor = 1
      ORDER BY e.block_index DESC, e.tx_index DESC, e.event_index DESC, e.id DESC
      LIMIT ?1 OFFSET ?2`,
    limit,
    offset,
  );
}

export interface RecentLaunchRow {
  tx_hash: string;
  asset: string;
  source: string;
  announce_block: number | null;
  start_block: number;
  end_block: number;
  price: string;
  quantity_by_price: string;
  hard_cap: string;
  divisible: number;
  phase: string;
  status: string;
  mints: number;
  minters: number;
  paid_quantity: string | null;
}

/**
 * Every conforming launch, newest announcement first, across all four phases.
 *
 * `conforming = 1` and not `IS NOT 0` here, unlike the mint tape: a mint is
 * something a person did and is worth showing while its launch is still being
 * judged, but listing an undecided launch in a feed of launches is publishing
 * the verdict this site exists to make before it has been made.
 */
export function listRecentLaunches(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecentLaunchRow[]> {
  return q<RecentLaunchRow>(
    db,
    `SELECT tx_hash, asset, source, announce_block, start_block, end_block,
            price, quantity_by_price, hard_cap, divisible, phase, status,
            mints, minters, paid_quantity
       FROM launches
      WHERE conforming = 1
      ORDER BY announce_block DESC, tx_index DESC
      LIMIT ?1 OFFSET ?2`,
    limit,
    offset,
  );
}

export interface OrderRow {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  source: string;
  asset: string;
  side: string;
  token_quantity: string;
  xcp_quantity: string;
  token_remaining: string;
  xcp_remaining: string;
  status: string;
  expire_index: number;
  divisible: number;
}

/**
 * The mirrored order book, newest first.
 *
 * `live` narrows to what is still resting, and it is not a WHERE bolted onto
 * the same plan — migration 0022 gives it a partial index of its own, because
 * terminal orders accumulate forever while open ones do not, so the live book
 * shrinks as a share of this table and deserves not to be found by filtering
 * everything that ever rested.
 *
 * The join is a covering-index lookup per row for divisibility. Storing it on
 * the order would denormalise a fact that already has one home and can, in
 * principle, be corrected there.
 */
export function listRecentOrders(
  db: D1Database,
  live: boolean,
  limit: number,
  offset: number,
): Promise<OrderRow[]> {
  return q<OrderRow>(
    db,
    `SELECT o.tx_hash, o.tx_index, o.block_index, o.source, o.asset, o.side,
            o.token_quantity, o.xcp_quantity, o.token_remaining, o.xcp_remaining,
            o.status, o.expire_index,
            COALESCE(l.divisible, 1) AS divisible
       FROM orders o
       LEFT JOIN launches l ON l.asset = o.asset
      ${live ? "WHERE o.status = 'open'" : ""}
      ORDER BY o.block_index DESC, o.tx_index DESC
      LIMIT ?1 OFFSET ?2`,
    limit,
    offset,
  );
}

export interface ConformingAsset {
  asset: string;
  divisible: number;
  /** The pool this launch mints its liquidity into at graduation. It is what
   *  distinguishes the pool the protocol created — whose LP went straight to
   *  the unspendable address and can never be withdrawn — from an ordinary
   *  pool somebody opened by hand on the same asset. */
  lp_asset: string | null;
}

/** The covered set, with the columns a caller needs to interpret a row it got
 *  from somewhere other than D1. Mempool membership has its own candidate-
 *  bounded lookup; this full set is for callers that truly need every row. */
export function listConformingAssetInfo(db: D1Database): Promise<ConformingAsset[]> {
  return q<ConformingAsset>(
    db,
    `SELECT asset, divisible, lp_asset FROM launches WHERE conforming = 1`,
  );
}

/**
 * The assets that actually have a market, deepest pool first.
 *
 * An XCP-69 token does not exist until its launch closes, so only a graduated
 * launch can have an order book at all — asking Counterparty about the other
 * hundred would be a hundred requests guaranteed to return nothing. Depth
 * order matters because the caller has to cap the fan-out somewhere, and the
 * deepest pools are where the book is; `idx_launches_depth` is exactly this
 * query's index, so no new one is needed.
 */
export function listMarketAssets(
  db: D1Database,
  limit: number,
): Promise<ConformingAsset[]> {
  return q<ConformingAsset>(
    db,
    `SELECT asset, divisible
       FROM launches
      WHERE conforming = 1 AND phase = 'graduated'
      ORDER BY pool_xcp_sats DESC
      LIMIT ?1`,
    limit,
  );
}

export interface ActivityTotals {
  mints: number;
  trades: number;
  burns: number;
  launches: number;
}

/**
 * How much has ever happened here, for the tab labels.
 *
 * Mints come from `mint_totals`, the single materialised row migration 0010
 * added — so this is a primary-key lookup rather than the COUNT over
 * launch_mints it looks like. Trades and launches are counted live, each
 * against an index that covers its own filter, so neither reads a row it does
 * not count. One statement, because three round trips for three numbers that
 * are always shown together is three billed queries for one answer.
 *
 * Orders are absent on purpose: the book lives on Counterparty, not in this
 * database, and the route that reads it reports its own total. Counting it
 * here would mean a fan-out on every page load for a number in a tab label.
 */
export function getActivityTotals(db: D1Database): Promise<ActivityTotals | null> {
  return one<ActivityTotals>(
    db,
    `SELECT
       (SELECT COALESCE(mints, 0) FROM mint_totals WHERE id = 1) AS mints,
       (SELECT COUNT(*) FROM asset_events WHERE primary_actor = 1) AS trades,
       (SELECT COALESCE(burns, 0) FROM burn_totals WHERE id = 1) AS burns,
       (SELECT COUNT(*) FROM launches WHERE conforming = 1) AS launches`,
  );
}
