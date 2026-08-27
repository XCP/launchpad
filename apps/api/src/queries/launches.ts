import { one, q } from "#api/db";
import type { LaunchPhase } from "@launchpad/xcp69/xcp69";

export interface LaunchRow {
  tx_hash: string;
  tx_index: number;
  asset: string;
  asset_longname: string | null;
  source: string;
  divisible: number;
  announce_block: number | null;
  original_deadline: number | null;
  start_block: number;
  end_block: number;
  price: string;
  quantity_by_price: string;
  hard_cap: string;
  soft_cap: string;
  pool_quantity: string | null;
  max_mint_per_tx: string;
  max_mint_per_address: string | null;
  premint_quantity: string;
  minted_asset_commission_int: string | null;
  burn_payment: number;
  lock_quantity: number;
  lock_description: number;
  lp_asset: string | null;
  description: string | null;
  conforming: number | null;
  conformance_version: number;
  status: string;
  phase: string;
  earned_quantity: string | null;
  paid_quantity: string | null;
  current_deadline_block: number;
  mints: number;
  minters: number;
  pool_xcp_reserve: string | null;
  pool_token_reserve: string | null;
  pool_xcp_sats: number;
  seen_at_block: number;
  updated_at: number;
  /** Block of this launch's most recent mint; null if it has never minted.
   *  See migration 0012 — derived from launch_mints, never counted. */
  last_mint_block: number | null;
  /** Write-once graduation timestamp and XCP/USD mark. Together they define
   *  the token's fixed dollar launch baseline. */
  launch_time: number | null;
  launch_xcp_usd: number | null;
  /** Creator prose mirrored from hosted metadata. Empty means checked with no
   *  safe prose; null means the metadata worklist has not reached it yet. */
  display_description: string | null;
}

const BASE_COLUMNS = `tx_hash, tx_index, asset, asset_longname, source, divisible,
  announce_block, original_deadline, start_block, end_block, price,
  quantity_by_price, hard_cap, soft_cap, pool_quantity, max_mint_per_tx,
  max_mint_per_address, premint_quantity, minted_asset_commission_int,
  burn_payment, lock_quantity, lock_description, lp_asset, description,
  conforming, conformance_version, status, phase, earned_quantity,
  paid_quantity, current_deadline_block, mints, minters, pool_xcp_reserve,
  pool_token_reserve, pool_xcp_sats, seen_at_block, updated_at,
  last_mint_block, launch_time, launch_xcp_usd`;

/** Detail reads get the full creator prose. */
const COLUMNS = `${BASE_COLUMNS}, display_description`;

/** Lists only need the one-line card copy, and only graduated cards render it.
 *  This bounds the cached homepage payload even if an issuer used the full
 *  2,000-character description allowance. */
const LIST_COLUMNS = `${BASE_COLUMNS},
  CASE WHEN phase = 'graduated'
       THEN substr(display_description, 1, 280)
       ELSE NULL
  END AS display_description`;

/**
 * The phases, in the order the index page stacks them.
 *
 * This is also the query plan. One statement per phase, each a seek into
 * idx_launches_rank that stops at its own LIMIT, so the rows this reads are
 * bounded by what it returns rather than by how big the table is.
 *
 * It replaced a single window function — ROW_NUMBER() OVER (PARTITION BY phase
 * ORDER BY <rank>) — which was 66% of every row this database read: 204 rows
 * per call from a 44-row table to return about 36, because a computed rank
 * cannot be indexed and SQLite had to sort the whole conforming set to find
 * the top of each phase. The rank now lives in the `rank_key` generated column
 * (migration 0009), which is the only definition of it; nothing here restates
 * the arithmetic, so the two cannot drift.
 *
 * `LaunchPhase` is a closed union of exactly these four, so enumerating them
 * cannot silently drop a phase the way a hardcoded list of an open set would.
 */
const PHASE_ORDER: readonly LaunchPhase[] = [
  "graduated",
  "minting",
  "scheduled",
  "refunded",
] as const;

/** The index page: up to `perPhase` conforming launches per phase, each phase
 *  ranked by the key that phase is actually judged by (see migration 0009).
 *
 *  One `batch`, so four statements still cost one round trip — the point is to
 *  read fewer rows, not to trade a sort for four trips to the database. */
export async function listLaunches(
  db: D1Database,
  perPhase: number,
): Promise<LaunchRow[]> {
  const stmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM launches
      WHERE conforming = 1 AND phase = ?1
      ORDER BY rank_key DESC, tx_index DESC
      LIMIT ?2`,
  );
  const perPhaseRows = await db.batch<LaunchRow>(
    PHASE_ORDER.map((phase) => stmt.bind(phase, perPhase)),
  );
  // Concatenated in PHASE_ORDER, which is what the old query's trailing
  // ORDER BY CASE phase ... produced — the ordering is now structural rather
  // than something the database has to sort for.
  return perPhaseRows.flatMap((r) => r.results);
}

/** Is this string one of the four phases? The paged route takes the phase from
 *  a query string, and everything downstream — the index seek, the count —
 *  assumes it is real. */
export function isLaunchPhase(s: string): s is LaunchPhase {
  return (PHASE_ORDER as readonly string[]).includes(s);
}

/**
 * The orderings a section can ask for, as SQL.
 *
 * A whitelist, and the ONLY place a sort id becomes SQL. The id arrives in a
 * query string and is interpolated into an ORDER BY — which cannot be a bound
 * parameter — so the mapping has to be a closed table rather than anything
 * derived from the input. An unknown id falls back to the phase's default; it
 * is never passed through.
 *
 * These mirror the sort menus in launch-sections.tsx one for one, because the
 * browser can no longer sort what it was sent: it holds one page, so ordering
 * has to happen where the whole phase is. Each entry says which index serves
 * it, since that is the difference between a seek and a sort:
 *
 *  - progress / mcap → idx_launches_rank. `rank_key` IS the phase's own
 *    measure (migration 0009): progress toward the soft cap while minting,
 *    price — and therefore market cap, the supply being fixed — once
 *    graduated. Index-served, no sort at all.
 *  - closing / minters / newest / soonest → no index. SQLite reads the phase
 *    off idx_launches_rank's `phase=?` seek and sorts it, so the rows read are
 *    bounded by the size of ONE PHASE rather than by the table. That is the
 *    property that matters for D1 billing, and it is why these are acceptable
 *    unindexed at this size. When a phase gets big enough for that sort to
 *    show up in the row counts, each of these becomes a partial index on
 *    (phase, <key>, tx_index DESC) WHERE conforming = 1 — the same shape as
 *    0009 — and nothing else has to change.
 *
 * `newest` restates launch-sections.tsx's `announced()` deliberately: the
 * announcement block is the honest age, but it is 0 or NULL for a launch whose
 * announcement was never resolved, and 0 sorts the newest launch last under
 * DESC. start_block stands in for exactly those rows.
 */
const SORT_SQL = {
  progress: "rank_key DESC",
  mcap: "rank_key DESC",
  closing: "current_deadline_block ASC",
  minters: "minters DESC",
  newest: "(CASE WHEN announce_block > 0 THEN announce_block ELSE start_block END) DESC",
  soonest: "start_block ASC",
  // A graduated launch's final mint is the transaction that sold it out.
  // Oldest first identifies bounty places; market-cap order cannot.
  graduated: "last_mint_block ASC, COALESCE(last_mint_tx_index, 0) ASC",
} as const;

export type LaunchSort = keyof typeof SORT_SQL;

/** The sort a phase falls back to — the same one listLaunches has always
 *  returned that phase in, so an omitted or unrecognised `sort` gives the
 *  ordering this API already had. */
const DEFAULT_SORT: Record<LaunchPhase, LaunchSort> = {
  graduated: "mcap",
  // Progress, per migration 0009 — the launches closest to actually happening.
  //
  // Briefly changed to recency, on the theory that a new launch buried at the
  // bottom can never attract the 69 minters it needs. The premise was already
  // false by then: paging this endpoint is what made every open fairminter
  // reachable, and `sort=newest` puts the newest first for anyone who asks.
  // Recency as the DEFAULT is a different thing — issuing a fairminter is
  // cheap, so it makes the front page a function of who created something most
  // recently, which is both gameable and permanently churning.
  minting: "progress",
  scheduled: "soonest",
  refunded: "newest",
};

export interface LaunchPage {
  rows: LaunchRow[];
  /**
   * The launch that minted most recently, out of everything still minting.
   *
   * Answered here rather than picked out of `rows` by the caller, because the
   * caller only ever holds one page. The reigning launch is a fact about the
   * whole phase, and on any page but the first it is usually not among the
   * rows the caller can see — a browser choosing from what it was sent would
   * quietly crown the best of twelve and call it the best of forty.
   *
   * Null for every phase but minting, and null while nothing has minted.
   */
  king: LaunchRow | null;
  /** Conforming launches in this phase — the whole of it, not this page. The
   *  pager needs the size of the list it is paging, and it is the one number a
   *  LIMITed query cannot tell you about itself. */
  total: number;
}

/**
 * One page of one phase, plus how many there are in total.
 *
 * This is what replaced handing the browser a fixed-size prefetch and letting
 * it slice: the count and the page now come from one query against one table,
 * so the pager can no longer disagree with the heading above it.
 *
 * Both statements go in a single `batch` — the count is a second statement,
 * not a second round trip. It reads the phase off idx_launches_listed as a
 * covering index, the same way countByPhase does.
 *
 * OFFSET makes SQLite walk and discard the rows it skips, so a deep page costs
 * what every page before it cost. That is the accepted trade for numbered
 * pages — they are addressable and a cursor is not — and it stays cheap while
 * a phase is hundreds of rows. Past that the fix is keyset pagination on
 * (rank_key, tx_index), which the index already supports.
 */
export async function listLaunchPage(
  db: D1Database,
  phase: LaunchPhase,
  sort: string | undefined,
  limit: number,
  offset: number,
  unmintedBy?: string,
): Promise<LaunchPage> {
  // The lookup is the validation: anything not a key of the table lands on the
  // phase's default, so no caller-supplied string ever reaches the SQL.
  const key: LaunchSort =
    sort && sort in SORT_SQL ? (sort as LaunchSort) : DEFAULT_SORT[phase];
  // tx_index breaks every tie, so two launches that compare equal cannot swap
  // places between two renders — which across pages is worse than untidy: a
  // row can appear twice, or not at all.
  const order = `${SORT_SQL[key]}, tx_index DESC`;

  /**
   * A wallet filter belongs inside the query, not after LIMIT. Filtering the
   * returned twelve rows in the browser would make short pages, wrong totals,
   * and eventually empty pages even while unminted launches still existed.
   *
   * idx_launch_mints_minter is (launch_tx, source), exactly the two equality
   * terms in this anti-join. Each candidate launch is therefore one indexed
   * existence lookup; it does not scan the append-only mint table. The source
   * is always bound, and each statement uses the placeholder number matching
   * its own existing binds.
   */
  const notMintedPage = unmintedBy
    ? ` AND NOT EXISTS (
          SELECT 1 FROM launch_mints m
           WHERE m.launch_tx = launches.tx_hash AND m.source = ?4
        )`
    : "";
  const notMintedCount = unmintedBy
    ? ` AND NOT EXISTS (
          SELECT 1 FROM launch_mints m
           WHERE m.launch_tx = launches.tx_hash AND m.source = ?2
        )`
    : "";
  const notMintedKing = unmintedBy
    ? ` AND NOT EXISTS (
          SELECT 1 FROM launch_mints m
           WHERE m.launch_tx = launches.tx_hash AND m.source = ?1
        )`
    : "";

  /**
   * The reigning launch, asked for only where it can exist.
   *
   * A third statement in the same batch rather than a second round trip, and
   * only for the minting phase — the other three would each pay for a query
   * whose answer is always null. It reads with no index by design: this is a
   * few dozen rows out of a table in the low hundreds, and migration 0012
   * spells out why an index would cost more than the scan it saved.
   */
  const wantsKing = phase === "minting";

  const statements = [
    db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM launches
          WHERE conforming = 1 AND phase = ?1${notMintedPage}
          ORDER BY ${order}
          LIMIT ?2 OFFSET ?3`,
      )
      .bind(phase, limit, offset, ...(unmintedBy ? [unmintedBy] : [])),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM launches WHERE conforming = 1 AND phase = ?1${notMintedCount}`,
      )
      .bind(phase, ...(unmintedBy ? [unmintedBy] : [])),
  ];
  if (wantsKing) {
    const kingStatement = db.prepare(
        // Recency first, then the two tiebreaks that only apply WITHIN one
        // block (migration 0013): how many of this launch's mints are in it,
        // then the last of those mints by Counterparty's global tx_index.
        //
        // Count before index because ordering inside a block is miner
        // ordering — five mints arriving is a stronger claim on the slot than
        // one that happened to be sequenced last. The launch's own tx_index
        // still ends the sort, so the result is total and cannot flicker
        // between two renders.
        `SELECT ${LIST_COLUMNS} FROM launches
          WHERE conforming = 1 AND phase = 'minting' AND last_mint_block IS NOT NULL${notMintedKing}
          ORDER BY last_mint_block DESC,
                   COALESCE(last_mint_count, 0) DESC,
                   COALESCE(last_mint_tx_index, 0) DESC,
                   tx_index DESC
          LIMIT 1`,
      );
    // D1 statements with no placeholders should be batched directly. Calling
    // bind() with zero arguments is unnecessary and is not consistently
    // accepted by local Miniflare and the production D1 implementation.
    statements.push(unmintedBy ? kingStatement.bind(unmintedBy) : kingStatement);
  }

  const [page, count, king] = await db.batch<LaunchRow & { n: number }>(statements);

  return {
    rows: page.results as LaunchRow[],
    total: (count.results[0] as { n: number } | undefined)?.n ?? 0,
    king: wantsKing ? ((king?.results[0] as LaunchRow | undefined) ?? null) : null,
  };
}

export interface SearchIndexRow {
  asset: string;
  asset_longname: string | null;
  source: string;
  phase: string;
  announce_block: number | null;
  start_block: number;
  minters: number;
  earned_quantity: string | null;
  soft_cap: string;
  hard_cap: string;
  pool_xcp_reserve: string | null;
  pool_token_reserve: string | null;
}

/**
 * Every conforming launch, in the twelve columns search actually ranks on.
 *
 * Search has to see the whole index or it is lying: a launch it cannot find by
 * its exact ticker is worse than one missing from a list, because the user has
 * told you precisely what they want and been told it does not exist. So this
 * is deliberately unpaged — it is a membership set, not a list to read.
 *
 * Twelve columns rather than the thirty-seven `COLUMNS` selects, because the
 * whole set travels at once and most of a launch row is detail no search
 * result shows. The quantities come back RAW, not pre-divided into a price or
 * a percentage: this repo does its standard math in integer satoshi and the
 * client already owns those helpers, so sending a float would be a second
 * implementation of arithmetic that has to agree with the first.
 *
 * It stays affordable because it is fetched when the search dialog first
 * opens, not on page load — most visits never pay for it — and because the
 * edge cache collapses it to about one read per colo per minute.
 */
export function listSearchIndex(db: D1Database): Promise<SearchIndexRow[]> {
  return q<SearchIndexRow>(
    db,
    `SELECT asset, asset_longname, source, phase, announce_block, start_block,
            minters, earned_quantity, soft_cap, hard_cap,
            pool_xcp_reserve, pool_token_reserve
       FROM launches WHERE conforming = 1`,
  );
}

/** Every conforming launch's ticker — the membership test /v2/mempool needs
 *  to decide which unconfirmed mints this site has an opinion about. A single
 *  column off the partial index, not the full rows the client used to download
 *  to answer the same question. */
export async function listConformingAssets(db: D1Database): Promise<string[]> {
  const rows = await q<{ asset: string }>(
    db,
    `SELECT asset FROM launches WHERE conforming = 1`,
  );
  return rows.map((r) => r.asset);
}

export interface PhaseCount {
  phase: string;
  n: number;
  /** Raw XCP satoshi currently recorded on launches in this phase. */
  paid_xcp: number;
  /** Raw XCP satoshi currently held by pools in this phase. */
  pool_xcp: number;
  /** Current combined market cap in raw XCP satoshi. */
  market_cap_xcp: number;
}

/** How many conforming launches sit in each phase, and their current capital.
 *  One grouped read — the homepage shows a slice per section and needs to say
 *  how big the whole is, and /stats is the same question asked directly.
 *  Summing launch rows also gives us active escrow and graduated market data
 *  without rescanning mints or making one pool request per asset. */
export function countByPhase(db: D1Database): Promise<PhaseCount[]> {
  return q<PhaseCount>(
    db,
    `SELECT phase,
            COUNT(*) AS n,
            CAST(COALESCE(SUM(CAST(paid_quantity AS INTEGER)), 0) AS INTEGER) AS paid_xcp,
            CAST(COALESCE(SUM(pool_xcp_sats), 0) AS INTEGER) AS pool_xcp,
            CAST(COALESCE(SUM(
              CASE
                WHEN pool_token_reserve IS NOT NULL
                 AND CAST(pool_token_reserve AS REAL) > 0
                THEN CAST(hard_cap AS REAL)
                   * CAST(pool_xcp_reserve AS REAL)
                   / CAST(pool_token_reserve AS REAL)
                ELSE 0
              END
            ), 0) AS INTEGER) AS market_cap_xcp
       FROM launches
      WHERE conforming = 1
      GROUP BY phase`,
  );
}

export function getLaunch(db: D1Database, asset: string): Promise<LaunchRow | null> {
  // A ticker can be re-launched (migration 0016), so this pick is a policy,
  // not a lookup: the conforming record is the one this site has an opinion
  // about, and between two the newer fairminter is the live story. A pending
  // verdict (NULL) ranks below a settled conforming row, so a relaunch takes
  // the page over only once it has actually passed the predicate.
  return one<LaunchRow>(
    db,
    `SELECT ${COLUMNS} FROM launches WHERE asset = ?1
      ORDER BY (conforming IS 1) DESC, tx_index DESC
      LIMIT 1`,
    asset,
  );
}

/** A wallet's own launches, newest-announced first. Non-conforming launches
 *  are excluded for the same reason they're excluded everywhere else — this
 *  site shows only XCP-69 — but a NULL verdict is kept, so a launch that was
 *  just created still appears while the indexer resolves it. */
export function getLaunchesBySource(db: D1Database, source: string): Promise<LaunchRow[]> {
  return q<LaunchRow>(
    db,
    `SELECT ${COLUMNS} FROM launches
     WHERE source = ?1 AND conforming IS NOT 0
     ORDER BY announce_block DESC`,
    source,
  );
}

export interface SourceMintRow {
  tx_hash: string;
  launch_tx: string;
  asset: string;
  divisible: number;
  phase: string;
  block_index: number;
  earn_quantity: string;
  paid_quantity: string;
}

/** Every mint an address has made, newest first, with the launch it belongs
 *  to. The ledger alone can't answer this: an `escrowed fairmint` debit is
 *  XCP-only, so nothing in it names the asset being minted.
 *
 *  Non-conforming launches are excluded — this site shows only XCP-69. The
 *  test is `IS NOT 0` rather than `= 1` because NULL means the verdict hasn't
 *  been reached yet, which is not the same as failing it; `= 1` would make a
 *  mint vanish until the indexer catches up. */
export function getMintsBySource(
  db: D1Database,
  source: string,
  limit: number,
  offset = 0,
): Promise<SourceMintRow[]> {
  return q<SourceMintRow>(
    db,
    `SELECT m.tx_hash, m.launch_tx, l.asset, l.divisible, l.phase,
            m.block_index, m.earn_quantity, m.paid_quantity
     FROM launch_mints m
     JOIN launches l ON l.tx_hash = m.launch_tx
     WHERE m.source = ?1 AND l.conforming IS NOT 0
     ORDER BY m.block_index DESC, m.tx_hash DESC
     LIMIT ?2 OFFSET ?3`,
    source,
    limit,
    offset,
  );
}

export interface AssetEventRow {
  event: string;
  asset: string;
  block_index: number;
  token_delta: string;
  xcp_delta: string;
  kind: string;
}

/** An address's trades on XCP-69 assets. One indexed read — the whole point
 *  of the asset_events table is that this replaces paginating the address's
 *  entire Counterparty ledger in the browser. */
export function getEventsBySource(
  db: D1Database,
  address: string,
  limit: number,
  offset = 0,
): Promise<AssetEventRow[]> {
  return q<AssetEventRow>(
    db,
    `SELECT event, asset, block_index, token_delta, xcp_delta, kind
     FROM asset_events
     WHERE address = ?1
     ORDER BY block_index DESC, event DESC, asset DESC
     LIMIT ?2 OFFSET ?3`,
    address,
    limit,
    offset,
  );
}

export interface MinterRow {
  source: string;
  earned: string;
  paid: string;
  mints: number;
}

export interface FeeSummary {
  total_fee_sats: number;
  counted: number;
  mints: number;
}

/** Bitcoin-side cost of a launch's mints, summed once at read time. `counted`
 *  can trail `mints` — a fee lookup can fail (see fetchTxFee) — so the
 *  caller can tell a true zero from an incomplete sample. */
export function sumFees(db: D1Database, launchTx: string): Promise<FeeSummary | null> {
  return one<FeeSummary>(
    db,
    `SELECT CAST(COALESCE(SUM(fee_sats), 0) AS INTEGER) AS total_fee_sats,
            COUNT(fee_sats) AS counted,
            COUNT(*) AS mints
     FROM launch_mints
     WHERE launch_tx = ?1`,
    launchTx,
  );
}

export function listMinters(
  db: D1Database,
  launchTx: string,
  limit: number,
): Promise<MinterRow[]> {
  // Exact sums via SQLite's own arbitrary-precision-free integer add would
  // overflow past 2^63 in principle; token quantities here top out at 1e16,
  // comfortably inside i64, so a plain SUM is safe for this table only.
  return q<MinterRow>(
    db,
    `SELECT source,
            CAST(SUM(CAST(earn_quantity AS INTEGER)) AS TEXT) AS earned,
            CAST(SUM(CAST(paid_quantity AS INTEGER)) AS TEXT) AS paid,
            COUNT(*) AS mints
     FROM launch_mints
     WHERE launch_tx = ?1
     GROUP BY source
     ORDER BY SUM(CAST(earn_quantity AS INTEGER)) DESC
     LIMIT ?2`,
    launchTx,
    limit,
  );
}

export interface ActivityTotals {
  mints: number;
  minters: number;
  /** XCP satoshi paid into every conforming launch, ever. */
  paid_xcp: number;
  /** Bitcoin satoshi spent on mint transaction fees. */
  fee_sats: number;
  /** Conforming mints whose Bitcoin fee has been indexed. */
  fee_samples: number;
  /** Median observed Bitcoin fee per conforming mint transaction. */
  median_fee_sats: number;
}

/**
 * Site-wide minting activity, computed from scratch.
 *
 * A full pass over launch_mints is inherent — no index avoids a COUNT or a
 * SUM, and COUNT(DISTINCT) needs a temp b-tree besides. That is why this no
 * longer runs at read time: /v2/stats reads `readMintTotals` below, and this
 * runs only when the indexer sees something that could have changed the
 * answer. See migration 0010.
 *
 * It remains the single definition of what the number MEANS. The rollup stores
 * this query's result rather than accumulating its own counters, so the two
 * cannot disagree — re-deriving always lands where a live query would.
 *
 * Only conforming launches count. A non-conforming fairminter's mints are
 * real, but this site's numbers describe XCP-69, and mixing the two would
 * report activity for launches it refuses to list.
 */
export function activityTotals(db: D1Database): Promise<ActivityTotals[]> {
  return q<ActivityTotals>(
    db,
    `WITH eligible AS (
       SELECT m.source, m.paid_quantity, m.fee_sats
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
     ),
     ranked_fees AS (
       SELECT fee_sats,
              ROW_NUMBER() OVER (ORDER BY fee_sats) AS rn,
              COUNT(*) OVER () AS n
         FROM eligible
        WHERE fee_sats IS NOT NULL
     )
     SELECT
       (SELECT COUNT(*) FROM eligible) AS mints,
       (SELECT COUNT(DISTINCT source) FROM eligible) AS minters,
       CAST(COALESCE((SELECT SUM(CAST(paid_quantity AS INTEGER)) FROM eligible), 0) AS INTEGER) AS paid_xcp,
       CAST(COALESCE((SELECT SUM(fee_sats) FROM eligible), 0) AS INTEGER) AS fee_sats,
       (SELECT COUNT(*) FROM ranked_fees) AS fee_samples,
       COALESCE((
         SELECT CAST(AVG(fee_sats) AS INTEGER)
           FROM ranked_fees
          WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
       ), 0) AS median_fee_sats`,
  );
}

/**
 * XCP that has actually changed hands on XCP-69 assets, in raw satoshi.
 *
 * Daily candles are folded from the matches themselves, not the per-address
 * event rows: an order match has two actors but exactly one execution price.
 * That makes each candle's volume a once-only fill total across pool and book,
 * and preserves the day needed to mark the XCP at historical USD prices.
 *
 * This scans only the daily half of a compact OHLCV table and sits behind the
 * same five-minute cache as the rest of /v2/stats. If that table eventually
 * reaches the size where mint totals needed a rollup (migration 0010), this
 * can be materialised by the same write-time pattern.
 */
export interface TradeVolumeBucket {
  /** UTC day start from the daily price candle. */
  time: number;
  /** Raw XCP satoshi traded during that day. */
  xcp: number;
}

export function tradeVolumeByDay(db: D1Database): Promise<TradeVolumeBucket[]> {
  return q<TradeVolumeBucket>(
    db,
    `SELECT bucket_start AS time,
            CAST(SUM(CAST(volume_xcp AS INTEGER)) AS INTEGER) AS xcp
       FROM price_candles
      WHERE resolution = '1d'
      GROUP BY bucket_start
      ORDER BY bucket_start`,
  );
}

export interface MintBucket {
  bucket: number;
  n: number;
  minters: number;
}

export interface RefundBucket {
  bucket: number;
  n: number;
  xcp: number;
}

/** Refund closures by Bitcoin-day bucket. A refunded fairminter closes at its
 * current deadline, so that block is the event time rather than its announce
 * or start block. The phase set is small and this only runs on a stats-cache
 * miss. */
export function refundsByBucket(db: D1Database, sinceBucket: number): Promise<RefundBucket[]> {
  return q<RefundBucket>(
    db,
    `SELECT current_deadline_block / 144 AS bucket,
            COUNT(*) AS n,
            CAST(COALESCE(SUM(CAST(paid_quantity AS INTEGER)), 0) AS INTEGER) AS xcp
       FROM launches
      WHERE conforming = 1
        AND phase = 'refunded'
        AND current_deadline_block / 144 >= ?1
      GROUP BY bucket
      ORDER BY bucket`,
    sinceBucket,
  );
}

/**
 * Mints grouped into roughly-daily buckets of 144 blocks, computed from
 * scratch — the rollup's source, not the read path. See `readMintBuckets`.
 *
 * Blocks, not timestamps: launch_mints records the block a mint landed in and
 * nothing else, and 144 blocks is a Bitcoin day by design. The bucket is
 * therefore approximate against a wall clock and exact against the chain,
 * which is the right way round for this — the chart is labelled as
 * approximate rather than pretending to calendar precision.
 *
 * Every bucket, with no lower bound: the rollup stores the whole history and
 * the route slices the window it wants. A window baked in here would go stale
 * every block as height advances, which would mean recomputing constantly for
 * a reason unrelated to whether any mint actually happened.
 */
export function mintsByBucket(db: D1Database): Promise<MintBucket[]> {
  return q<MintBucket>(
    db,
    `SELECT m.block_index / 144 AS bucket,
            COUNT(*) AS n,
            COUNT(DISTINCT m.source) AS minters
       FROM launch_mints m
       JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
      GROUP BY bucket
      ORDER BY bucket`,
  );
}

/** The stored totals — one row by primary key, which is the entire point of
 *  migration 0010. Null only if the rollup row is somehow missing; the
 *  migration seeds it, so the caller's fallback is a belt-and-braces zero
 *  rather than an expected state. */
export function getMintTotals(db: D1Database): Promise<ActivityTotals | null> {
  return one<ActivityTotals>(
    db,
    `SELECT mints, minters, paid_xcp, fee_sats, fee_samples, median_fee_sats
       FROM mint_totals WHERE id = 1`,
  );
}

/**
 * The stored buckets from `sinceBucket` on, oldest first.
 *
 * `bucket` is the primary key, so this is an indexed range scan bounded by the
 * chart's own window rather than by how many mints exist.
 *
 * The window is applied in whole buckets, where the live query filtered by
 * block and then grouped. That made the oldest bar a partial day whenever the
 * window opened mid-bucket — a bar that looked like a quiet day but was really
 * a clipped one. Whole buckets is both cheaper and the more honest chart.
 */
export function listMintBuckets(db: D1Database, sinceBucket: number): Promise<MintBucket[]> {
  return q<MintBucket>(
    db,
    `SELECT bucket, n, minters FROM mint_buckets
      WHERE bucket >= ?1 ORDER BY bucket`,
    sinceBucket,
  );
}

export interface MinterEarning {
  source: string;
  mints: number;
  /** Distinct launches this address has minted, so the leaderboard can show
   *  breadth as well as volume — 69 addresses is what a launch needs. */
  launches: number;
  /** Raw XCP satoshi committed across those mints. */
  paid: string;
}

/**
 * Who has minted, most first — the rewards leaderboard.
 *
 * Counted per MINT TRANSACTION rather than per lot, because that is the unit
 * the reward is paid in: the Bitcoin fee a minter is being refunded is
 * charged per transaction, whatever quantity it carries.
 *
 * Conforming launches only, the same editorial line the rest of the site
 * draws — a mint against some other fairminter is a real Counterparty
 * transaction and none of this programme's business.
 */
export function minterEarnings(
  db: D1Database,
  limit: number,
  source?: string,
  offset = 0,
): Promise<MinterEarning[]> {
  // One query for both callers. A profile asking about itself and the
  // leaderboard listing everyone must never report different totals for the
  // same address, which two queries would eventually manage.
  const where = source ? "WHERE m.source = ?3" : "";
  const binds: (number | string)[] = source
    ? [limit, offset, source]
    : [limit, offset];
  return q<MinterEarning>(
    db,
    `WITH eligible AS (
       SELECT m.tx_hash, m.launch_tx, m.block_index, m.tx_index,
              m.source, m.paid_quantity
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
        ORDER BY m.block_index, COALESCE(m.tx_index, 0), m.tx_hash
        LIMIT 10000
     )
     SELECT m.source,
            COUNT(*) AS mints,
            COUNT(DISTINCT m.launch_tx) AS launches,
            CAST(SUM(CAST(m.paid_quantity AS INTEGER)) AS TEXT) AS paid
       FROM eligible m
       ${where}
      GROUP BY m.source
      ORDER BY mints DESC, paid DESC
      LIMIT ?1 OFFSET ?2`,
    ...binds,
  );
}
