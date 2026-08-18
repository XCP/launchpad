import { big } from "@launchpad/xcp69/numeric";
import { one, q } from "#api/db";
import {
  fetchAllFairminters,
  fetchAnnounceFacts,
  fetchBlockHeight,
  fetchFairmints,
  fetchPool,
} from "#api/integrations/counterparty";
import { syncAssetEvents, type GraduatedTarget } from "#api/indexer/events";
import { refreshRollup, rollupIsStale } from "#api/indexer/rollup";
import { fetchTxFee } from "#api/integrations/mempool";
import {
  isXcp69,
  launchPhase,
  MEMPOOL_BLOCK_INDEX,
  windowIsExact,
  xcp69Params,
  type Fairminter,
} from "@launchpad/xcp69/xcp69";

const CONFORMANCE_VERSION = 1;
const WORKLIST_LIMIT = 15;
const FEE_LOOKUP_CONCURRENCY = 10;
// SQLite's own bound-parameter ceiling (D1 doesn't raise it) — chunk any
// IN (...) built from a candidate list so this stays safe regardless of how
// many launches xcp.fun ends up tracking.
const SQL_VAR_LIMIT = 100;
// How many launch upserts ride in one batch. Same bound as the mint inserts'
// INSERT_CHUNK, for the same reason.
const UPSERT_CHUNK = 100;

interface StoredLaunch {
  tx_hash: string;
  earned_quantity: string | null;
  mints: number;
  minters: number;
  pool_xcp_reserve: string | null;
}

/** One batched read instead of one SELECT per candidate inside the main
 *  loop — at "hundreds of launches" scale, a per-row round trip serialized
 *  inside a for-loop is hundreds of sequential D1 reads every 2 minutes for
 *  no reason this data couldn't answer in one (chunked) query. */
async function fetchStoredByTxHash(
  db: D1Database,
  txHashes: string[],
): Promise<Map<string, StoredLaunch>> {
  const out = new Map<string, StoredLaunch>();
  for (let i = 0; i < txHashes.length; i += SQL_VAR_LIMIT) {
    const chunk = txHashes.slice(i, i + SQL_VAR_LIMIT);
    const placeholders = chunk.map((_, idx) => `?${idx + 1}`).join(",");
    const rows = await q<StoredLaunch>(
      db,
      `SELECT tx_hash, earned_quantity, mints, minters, pool_xcp_reserve
         FROM launches WHERE tx_hash IN (${placeholders})`,
      ...chunk,
    );
    for (const row of rows) out.set(row.tx_hash, row);
  }
  return out;
}

const truthy = (raw: unknown) => raw !== null && raw !== undefined && raw !== 0 && raw !== "0";

export interface SyncResult {
  candidates: number;
  written: number;
  resolved: number;
  mints_ingested: number;
  events_ingested: number;
  announce_backfilled: number;
  fees_backfilled: number;
  /** Rows the /v2/stats rollup rewrote. 0 on a tick where nothing that feeds
   *  it moved — which should be most of them. */
  rollup_written: number;
}

const FEE_BACKFILL_LIMIT = 15;

/**
 * One poll: list every fairminter, keep only the ones whose fixed parameters
 * could conform at all (xcp69Params — free, no subrequest), and mirror just
 * those into D1. Every write is delta-guarded: an unchanged row costs
 * nothing, because D1 bills per row a statement TOUCHES, not per row that
 * changed.
 */
export async function syncLaunches(db: D1Database): Promise<SyncResult> {
  const [all, height] = await Promise.all([fetchAllFairminters(), fetchBlockHeight()]);
  const candidates = all.filter((fm) => fm.asset && xcp69Params(fm));
  const storedByTxHash = await fetchStoredByTxHash(
    db,
    candidates.filter((fm) => fm.status === "open" || fm.status === "closed").map((fm) => fm.tx_hash),
  );

  let written = 0;
  let mintsIngested = 0;
  const eventTargets: GraduatedTarget[] = [];
  const now = Math.floor(Date.now() / 1000);
  // Collected through the loop and sent together below. Awaiting each upsert
  // inside the loop made the tick one sequential D1 round trip PER LAUNCH —
  // the same shape fetchStoredByTxHash exists to avoid on the read side, left
  // in place on the write side. The statements are unchanged and still
  // delta-guarded; only the number of trips to the database changes.
  const upserts: D1PreparedStatement[] = [];

  for (const fm of candidates) {
    // Pending rows can be judged immediately — their own block_index IS the
    // announcement block until the launch opens and it gets rewritten. Past
    // pending, the verdict needs the creation event (resolved below) and
    // stays NULL (undecided) until then; once decided it is never
    // recomputed here, only by the worklist pass, so a first-time decision
    // is never silently overwritten back to NULL on the next tick.
    const pendingVerdict = fm.status === "pending" ? isXcp69(fm, undefined) : null;

    // Capture the announcement block NOW, while the row still knows it. A
    // pending row's own block_index IS that block; the moment the launch
    // opens, Counterparty rewrites the field to the opening block and the
    // fact is gone from the listing forever. It used to be recorded only by
    // resolveUndecided, which a pending row never reaches — it already has a
    // verdict — so any launch this indexer first saw while pending kept a
    // NULL announce_block for life, and sorted as block 0 wherever age was
    // the measure. Unconfirmed rows carry the mempool sentinel, not a height.
    const announceBlock =
      fm.status === "pending" &&
      fm.block_index > 0 &&
      fm.block_index < MEMPOOL_BLOCK_INDEX
        ? fm.block_index
        : null;

    let poolXcpReserve: string | null = null;
    let poolTokenReserve: string | null = null;
    let poolXcpSats = 0;
    let hasPool = false;
    if (fm.status === "closed" && truthy(fm.pool_quantity)) {
      const pool = await fetchPool(fm.asset);
      if (pool) {
        hasPool = true;
        const xcpIsA = pool.asset_a === "XCP";
        const xcpReserve = xcpIsA ? pool.reserve_a : pool.reserve_b;
        const tokenReserve = xcpIsA ? pool.reserve_b : pool.reserve_a;
        poolXcpReserve = String(xcpReserve);
        poolTokenReserve = String(tokenReserve);
        // Through big() rather than Number() straight off the wire: the
        // reserve arrives as a lossless string when it is large, and big()
        // is the one place that parsing is defined. Narrowing to a Number
        // afterwards is safe HERE and only here — this is an XCP balance, and
        // XCP's whole supply is ~2.6e14 satoshi, two orders below 2^53. A
        // token reserve would not survive the same treatment, which is why
        // pool_token_reserve stays a string.
        poolXcpSats = Number(big(xcpReserve));
      }
    }
    const phase = launchPhase(fm, hasPool);

    // earned_quantity moves only when a new mint lands, and it's already in
    // hand from the /fairminters listing — free, no extra request. Reading
    // it back before deciding means an unchanged launch skips the fairmints
    // re-fetch and re-batch entirely, instead of re-paginating and
    // re-diffing its whole mint history every tick forever. Pre-fetched
    // above in one batched query, not one SELECT per candidate here.
    const stored = storedByTxHash.get(fm.tx_hash) ?? null;
    const earnedChanged =
      String(fm.earned_quantity ?? "") !== String(stored?.earned_quantity ?? "");

    let mints = stored?.mints ?? 0;
    let minters = stored?.minters ?? 0;
    if ((fm.status === "open" || fm.status === "closed") && (!stored || earnedChanged)) {
      const fairmints = await fetchFairmints(fm.tx_hash);
      mints = fairmints.length;
      minters = new Set(fairmints.map((m) => m.source)).size;
      if (fairmints.length > 0) {
        // Counterparty's own list has no "since" filter, so the read above is
        // always the full history — that's a subrequest cost, not a D1 one.
        // The write is the one that must not repeat: without this guard,
        // every tick a launch mints would INSERT OR IGNORE its ENTIRE mint
        // history again, and D1 bills per row a statement TOUCHES (a
        // conflicting row still counts) — a launch with M mints so far would
        // cost an M-row write on every single tick it's still active, the
        // same "unconditional write over a full listing" shape that ran up
        // the prior project's bill. Only mints at or after the highest
        // block already on file are even candidates for insertion; the ones
        // already known are filtered out client-side before they ever reach
        // D1, not just de-duplicated by it. (`>=`, not `>`: multiple mints
        // can land in the boundary block, and OR IGNORE is what makes
        // re-checking that one block free.)
        const highWater = await one<{ max_block: number | null }>(
          db,
          `SELECT MAX(block_index) AS max_block FROM launch_mints WHERE launch_tx = ?1`,
          fm.tx_hash,
        );
        const sinceBlock = highWater?.max_block ?? -1;
        const candidates = fairmints.filter((m) => m.block_index >= sinceBlock);

        const stmt = db.prepare(
          `INSERT OR IGNORE INTO launch_mints
             (tx_hash, launch_tx, block_index, tx_index, source, earn_quantity, paid_quantity)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        );
        const batch = candidates.map((m) =>
          stmt.bind(
            m.tx_hash,
            fm.tx_hash,
            m.block_index,
            // Ordering for mints that share a block — see migration 0013.
            // Coalesced because it is the one field here a pre-0013 row will
            // not have, and a null would make the tiebreak unorderable rather
            // than merely undecided.
            m.tx_index ?? 0,
            m.source,
            String(m.earn_quantity),
            String(m.paid_quantity),
          ),
        );
        const results = candidates.length > 0 ? await db.batch(batch) : [];
        // Only rows this statement actually inserted — a mint already on
        // file is never asked about again, so the fee lookup below runs
        // exactly once per mint for the lifetime of the launch.
        const newlyInserted = candidates.filter(
          (_, idx) => (results[idx]!.meta.rows_written ?? 0) > 0,
        );
        mintsIngested += newlyInserted.length;

        /**
         * The crown: this launch's most recent mint block.
         *
         * Costs nothing on a quiet tick. It is keyed off newlyInserted, which
         * is already computed above and is empty on almost every tick — the
         * common case runs no statement at all, not a statement that finds
         * nothing to do.
         *
         * The max comes from the rows just inserted rather than from a fresh
         * MAX() over launch_mints, so this adds no read either. That is sound
         * because launch_mints is append-only and the guard below is `<`:
         * the column only ever moves forward, so a batch that happens to land
         * entirely at or below the stored value writes nothing.
         *
         * Delta-guarded and by primary key, so this touches exactly one row
         * and only when the answer actually changed — D1 bills rows a
         * statement touches, and a conflicting row still counts.
         */
        if (newlyInserted.length > 0) {
          const newest = newlyInserted.reduce(
            (max, m) => (m.block_index > max ? m.block_index : max),
            -1,
          );

          // How many of this launch's mints are in that block, and the last of
          // them — the two halves of the tiebreak (migration 0013).
          //
          // Read back rather than counted from `newlyInserted`, because a
          // block can be ingested across two ticks: the high-water filter
          // above is `>=` precisely so the boundary block is re-checked, so
          // this batch is not necessarily all of it. Counting the batch would
          // undercount a block that arrived in pieces, and the count decides
          // who wears the crown.
          //
          // One indexed lookup on (launch_tx, block_index), reading only the
          // mints in a single block, and only on a tick that ingested
          // something — which is almost never.
          const tie = await one<{ n: number; ti: number | null }>(
            db,
            `SELECT COUNT(*) AS n, MAX(tx_index) AS ti
               FROM launch_mints
              WHERE launch_tx = ?1 AND block_index = ?2`,
            fm.tx_hash,
            newest,
          );

          await db
            .prepare(
              // Distinctness on all three, so a tick that re-reads the same
              // block writes nothing, and `<=` so this can only ever move the
              // crown forward. D1 bills rows a statement touches.
              `UPDATE launches
                  SET last_mint_block = ?1, last_mint_count = ?2, last_mint_tx_index = ?3
                WHERE tx_hash = ?4
                  AND (last_mint_block IS NULL OR last_mint_block <= ?1)
                  AND (last_mint_block IS NOT ?1
                       OR last_mint_count IS NOT ?2
                       OR last_mint_tx_index IS NOT ?3)`,
            )
            .bind(newest, tie?.n ?? newlyInserted.length, tie?.ti ?? 0, fm.tx_hash)
            .run();
        }

        // Concurrent, not sequential: a burst of new mints in one tick used
        // to pay for every fee lookup back-to-back (up to a 10s timeout
        // each), which could run the whole job past the lock's 110s lease
        // and let the next cron tick start concurrently. Capped batches keep
        // worst case bounded regardless of burst size.
        for (let i = 0; i < newlyInserted.length; i += FEE_LOOKUP_CONCURRENCY) {
          const slice = newlyInserted.slice(i, i + FEE_LOOKUP_CONCURRENCY);
          await Promise.all(
            slice.map(async (m) => {
              const fee = await fetchTxFee(m.tx_hash);
              if (fee) {
                await db
                  .prepare(
                    `UPDATE launch_mints SET fee_sats = ?1, weight_wu = ?2 WHERE tx_hash = ?3`,
                  )
                  .bind(fee.feeSats, fee.weightWu, m.tx_hash)
                  .run();
              }
            }),
          );
        }
      }
    }

    const upsert = db
      .prepare(
        `INSERT INTO launches (
           tx_hash, tx_index, asset, asset_longname, source, divisible,
           start_block, end_block, price, quantity_by_price, hard_cap,
           soft_cap, pool_quantity, max_mint_per_tx, max_mint_per_address,
           premint_quantity, minted_asset_commission_int, burn_payment,
           lock_quantity, lock_description, lp_asset, description,
           conforming, conformance_version,
           status, phase, earned_quantity, paid_quantity,
           current_deadline_block, mints, minters,
           pool_xcp_reserve, pool_token_reserve, pool_xcp_sats,
           seen_at_block, updated_at, announce_block
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
           ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ${CONFORMANCE_VERSION},
           ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36
         )
         ON CONFLICT(tx_hash) DO UPDATE SET
           status = excluded.status,
           phase = excluded.phase,
           earned_quantity = excluded.earned_quantity,
           paid_quantity = excluded.paid_quantity,
           current_deadline_block = excluded.current_deadline_block,
           mints = excluded.mints,
           minters = excluded.minters,
           pool_xcp_reserve = excluded.pool_xcp_reserve,
           pool_token_reserve = excluded.pool_token_reserve,
           pool_xcp_sats = excluded.pool_xcp_sats,
           seen_at_block = excluded.seen_at_block,
           updated_at = excluded.updated_at,
           -- A stale conformance_version means the standard's own predicate
           -- changed since this row was last judged: its old verdict is
           -- reopened to NULL so it re-enters resolveUndecided's worklist
           -- and gets judged fresh, rather than grandfathering a verdict the
           -- current predicate never actually produced.
           conforming = CASE
             WHEN ?23 IS NOT NULL THEN ?23
             WHEN launches.conformance_version < ${CONFORMANCE_VERSION} THEN NULL
             ELSE launches.conforming
           END,
           conformance_version = ${CONFORMANCE_VERSION},
           -- Write-once. The stored value came from the row while it was
           -- pending (or from the creation event); the incoming one is NULL
           -- for every non-pending row, and re-deriving it is impossible
           -- once Counterparty has rewritten block_index. COALESCE fills the
           -- gap and never clobbers a fact already known.
           announce_block = COALESCE(launches.announce_block, excluded.announce_block)
         WHERE launches.status IS NOT excluded.status
            OR launches.phase IS NOT excluded.phase
            OR launches.earned_quantity IS NOT excluded.earned_quantity
            OR launches.paid_quantity IS NOT excluded.paid_quantity
            OR launches.current_deadline_block IS NOT excluded.current_deadline_block
            OR launches.mints IS NOT excluded.mints
            OR launches.minters IS NOT excluded.minters
            OR launches.pool_xcp_reserve IS NOT excluded.pool_xcp_reserve
            OR launches.pool_token_reserve IS NOT excluded.pool_token_reserve
            OR launches.pool_xcp_sats IS NOT excluded.pool_xcp_sats
            OR (?23 IS NOT NULL AND launches.conforming IS NULL)
            OR (?36 IS NOT NULL AND launches.announce_block IS NULL)
            OR launches.conformance_version < ${CONFORMANCE_VERSION}`,
      )
      .bind(
        fm.tx_hash,
        fm.tx_index,
        fm.asset,
        fm.asset_longname,
        fm.source,
        fm.divisible ? 1 : 0,
        fm.start_block,
        fm.end_block,
        String(fm.price),
        String(fm.quantity_by_price),
        String(fm.hard_cap),
        String(fm.soft_cap),
        fm.pool_quantity === null ? null : String(fm.pool_quantity),
        String(fm.max_mint_per_tx),
        fm.max_mint_per_address === null ? null : String(fm.max_mint_per_address),
        String(fm.premint_quantity),
        fm.minted_asset_commission_int === null
          ? null
          : String(fm.minted_asset_commission_int),
        fm.burn_payment ? 1 : 0,
        fm.lock_quantity ? 1 : 0,
        fm.lock_description ? 1 : 0,
        fm.lp_asset,
        fm.description ?? null,
        pendingVerdict === null ? null : pendingVerdict ? 1 : 0,
        fm.status,
        phase,
        fm.earned_quantity === null ? null : String(fm.earned_quantity),
        fm.paid_quantity === null ? null : String(fm.paid_quantity),
        fm.soft_cap_deadline_block,
        mints,
        minters,
        poolXcpReserve,
        poolTokenReserve,
        poolXcpSats,
        fm.status === "closed" ? fm.block_index : height,
        now,
        announceBlock,
      );
    upserts.push(upsert);

    // Trades are only possible once a pool exists, and the reserve moving is
    // the proof that one happened. Comparing against the reserve already
    // stored means a graduated launch nobody traded costs nothing here —
    // no feed reads, no MAX() probe, no writes.
    if (phase === "graduated" && pendingVerdict !== false) {
      eventTargets.push({
        asset: fm.asset,
        poolChanged: poolXcpReserve !== (stored?.pool_xcp_reserve ?? null),
      });
    }
  }

  // Chunked for the same reason the mint inserts are: a batch is one implicit
  // transaction and D1 bounds how much one can carry, so the limit belongs on
  // the batch rather than on however many launches the chain happens to hold.
  // Rolling back a chunk is harmless here — every statement is an idempotent
  // upsert that the next tick, five minutes later, simply repeats.
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const results = await db.batch(upserts.slice(i, i + UPSERT_CHUNK));
    written += results.filter((r) => (r.meta.rows_written ?? 0) > 0).length;
  }

  const eventsIngested = await syncAssetEvents(db, eventTargets, height);
  const resolved = await resolveUndecided(db);
  const announceBackfilled = await backfillAnnounceBlocks(db);
  const feesBackfilled = await backfillMissingFees(db);

  // Last, because it summarises everything above — and only when something
  // above could have changed the summary. On a quiet tick this is skipped
  // entirely, which is the whole reason materialising /v2/stats pays for
  // itself rather than just moving the cost from read time to write time.
  const stale = rollupIsStale({ mintsIngested, feesBackfilled, resolved });
  const rollup = stale ? await refreshRollup(db) : null;

  return {
    candidates: candidates.length,
    written,
    resolved,
    mints_ingested: mintsIngested,
    events_ingested: eventsIngested,
    announce_backfilled: announceBackfilled,
    fees_backfilled: feesBackfilled,
    rollup_written: rollup
      ? rollup.totals_written + rollup.buckets_written
      : 0,
  };
}

/**
 * Repairs rows that opened before this indexer recorded their announcement
 * block — the historical shape of the bug fixed above.
 *
 * Pending rows are excluded deliberately: theirs arrives free with the next
 * upsert, so asking Counterparty about them would buy a subrequest for a fact
 * already in hand. What's left is the genuinely unrecoverable set — rows past
 * pending whose block_index has been rewritten — and only the creation event
 * still knows the answer.
 *
 * A one-time worklist that drains to empty and stays there, backed by a
 * partial index so the probe costs nothing once it has.
 */
async function backfillAnnounceBlocks(db: D1Database): Promise<number> {
  const missing = await q<{ tx_hash: string }>(
    db,
    `SELECT tx_hash FROM launches
      WHERE announce_block IS NULL AND status != 'pending'
      ORDER BY tx_index LIMIT ?1`,
    WORKLIST_LIMIT,
  );
  if (missing.length === 0) return 0;

  let repaired = 0;
  for (const row of missing) {
    const { announceBlock, originalDeadline } = await fetchAnnounceFacts(row.tx_hash);
    if (announceBlock === null) continue; // event not visible yet — ask again next tick

    // The verdict is left exactly as it stands. It was reached from this same
    // launch's own pending row, where block_index WAS the announcement block,
    // so re-deriving it here could only reproduce the same answer at the cost
    // of reconstructing the whole record. This pass restores a missing fact;
    // it does not re-judge conformance.
    const res = await db
      .prepare(
        `UPDATE launches
            SET announce_block = ?1,
                original_deadline = COALESCE(original_deadline, ?2),
                updated_at = ?3
          WHERE tx_hash = ?4 AND announce_block IS NULL`,
      )
      .bind(announceBlock, originalDeadline, Math.floor(Date.now() / 1000), row.tx_hash)
      .run();
    if ((res.meta.rows_written ?? 0) > 0) repaired += 1;
  }
  return repaired;
}

/** A mint's fee lookup normally happens exactly once, the tick it's first
 *  inserted (see above) — but a single transient mempool.space failure used
 *  to leave it NULL forever, which the site had to caveat in its own UI
 *  ("6 of 8 known") rather than just show a real number. Retrying a small,
 *  bounded batch every tick means a miss self-heals within a few minutes
 *  instead of needing a one-off manual backfill ever again. */
async function backfillMissingFees(db: D1Database): Promise<number> {
  const missing = await q<{ tx_hash: string }>(
    db,
    `SELECT tx_hash FROM launch_mints WHERE fee_sats IS NULL LIMIT ?1`,
    FEE_BACKFILL_LIMIT,
  );
  if (missing.length === 0) return 0;

  let backfilled = 0;
  for (let i = 0; i < missing.length; i += FEE_LOOKUP_CONCURRENCY) {
    const slice = missing.slice(i, i + FEE_LOOKUP_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (row) => {
        const fee = await fetchTxFee(row.tx_hash);
        if (!fee) return false;
        await db
          .prepare(`UPDATE launch_mints SET fee_sats = ?1, weight_wu = ?2 WHERE tx_hash = ?3`)
          .bind(fee.feeSats, fee.weightWu, row.tx_hash)
          .run();
        return true;
      }),
    );
    backfilled += results.filter(Boolean).length;
  }
  return backfilled;
}

/** Rows whose parameters match but whose timing verdict is still unknown —
 *  each is asked about exactly once, ever, and drops out of this worklist
 *  the moment it's answered. */
async function resolveUndecided(db: D1Database): Promise<number> {
  const undecided = await db
    .prepare(
      `SELECT tx_hash, asset, source, divisible, start_block, end_block, price,
              quantity_by_price, hard_cap, soft_cap, pool_quantity,
              max_mint_per_tx, max_mint_per_address, premint_quantity,
              minted_asset_commission_int, burn_payment, lock_quantity,
              lock_description, lp_asset, description, status,
              current_deadline_block
       FROM launches WHERE conforming IS NULL ORDER BY tx_index LIMIT ?1`,
    )
    .bind(WORKLIST_LIMIT)
    .all<{
      tx_hash: string;
      asset: string;
      source: string;
      divisible: number;
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
      status: string;
      current_deadline_block: number;
    }>();

  let resolved = 0;
  for (const row of undecided.results) {
    const { announceBlock, originalDeadline } = await fetchAnnounceFacts(row.tx_hash);
    if (announceBlock === null) continue; // not confirmed yet — ask again next tick

    // Reconstructed straight from the stored columns — this is a non-pending
    // row (pending ones are decided in the main pass and never reach this
    // worklist), so block_index/confirmed are irrelevant to the predicate;
    // only announceBlock (passed explicitly below) matters for timing.
    const fm: Fairminter = {
      tx_hash: row.tx_hash,
      tx_index: 0,
      block_index: 0,
      source: row.source,
      asset: row.asset,
      asset_longname: null,
      description: row.description ?? "",
      price: row.price,
      quantity_by_price: row.quantity_by_price,
      hard_cap: row.hard_cap,
      soft_cap: row.soft_cap,
      soft_cap_deadline_block: row.current_deadline_block,
      start_block: row.start_block,
      end_block: row.end_block,
      burn_payment: Boolean(row.burn_payment),
      max_mint_per_tx: row.max_mint_per_tx,
      max_mint_per_address: row.max_mint_per_address,
      premint_quantity: row.premint_quantity,
      minted_asset_commission_int: row.minted_asset_commission_int,
      lock_description: Boolean(row.lock_description),
      lock_quantity: Boolean(row.lock_quantity),
      divisible: Boolean(row.divisible),
      pool_quantity: row.pool_quantity,
      lp_asset: row.lp_asset,
      status: row.status,
      earned_quantity: null,
      paid_quantity: null,
    };

    const conforming =
      isXcp69(fm, announceBlock) &&
      (row.status !== "closed" || windowIsExact(fm, originalDeadline));

    await db
      .prepare(
        `UPDATE launches
         SET announce_block = ?1, original_deadline = ?2, conforming = ?3, updated_at = ?4
         WHERE tx_hash = ?5 AND conforming IS NULL`,
      )
      .bind(announceBlock, originalDeadline, conforming ? 1 : 0, Math.floor(Date.now() / 1000), row.tx_hash)
      .run();
    resolved += 1;
  }
  return resolved;
}
