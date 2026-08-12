import {
  type Candle,
  type Fill,
  type Stored,
  foldCandles,
  bucketIds,
} from "@launchpad/xcp69/candles";
import { q } from "#api/db";
import {
  fetchOrderMatches,
  fetchPoolMatches,
  type CpMatch,
} from "#api/integrations/counterparty";

/**
 * Market events for graduated launches, stored per address.
 *
 * Only graduated launches are polled. A launch that is still minting has no
 * market yet, and its mints are already in launch_mints with exact paid and
 * earned amounts; a refunded one is finished and will never move again. So
 * the work here is bounded by the number of launches currently trading, and
 * a launch that stops trading stops costing anything at all.
 *
 * Write discipline, per this repo's history with D1: candidates are filtered
 * against a stored high-water block in JavaScript BEFORE any statement runs,
 * because D1 bills every row a statement touches and a conflicting row still
 * counts. Rows are immutable — no upsert, no sweep, no delete anywhere in
 * this file. A tick where nothing traded costs one cursor read TOTAL (not per
 * asset), no feed requests, and zero writes.
 */

export interface GraduatedTarget {
  asset: string;
  /** Skip the feeds entirely unless the pool moved since the last pass. */
  poolChanged: boolean;
}

interface EventRow {
  id: string;
  event: string;
  address: string;
  asset: string;
  block: number;
  tokenDelta: bigint;
  xcpDelta: bigint;
  kind: "buy" | "sell";
}

/**
 * Both feeds agree on one thing: `forward_asset` is what the row's PRIMARY
 * address receives. counterparty-core sets it from `tx1["get_asset"]` in both
 * cases — `ledger/markets.py:884` credits exactly that to the pool trader,
 * and `messages/order.py:697` does the same for tx1. So the token arriving is
 * a buy: tokens in, XCP out.
 *
 * Beyond that they are different shapes and are handled separately, the way
 * the exchange indexer separates them. Conflating them and inferring which is
 * which from whichever field happens to be populated is how a missing leg
 * goes unnoticed.
 */
/**
 * Quantities arrive as either a JSON number or, above 2^53, a string that
 * parseJsonLossless kept intact. BigInt() throws on anything that isn't a
 * plain integer literal — including the "1e+21" a float would stringify to —
 * and a throw here would abort the whole tick. So a value that isn't exactly
 * an integer is refused, and its row is dropped rather than guessed at.
 */
function rawInt(value: number | string): bigint | null {
  const s = String(value);
  return /^-?\d+$/.test(s) ? BigInt(s) : null;
}

function legs(asset: string, m: CpMatch) {
  const forwardIsToken = m.forward_asset === asset;
  const tokenQty = rawInt(forwardIsToken ? m.forward_quantity : m.backward_quantity);
  const xcpQty = rawInt(forwardIsToken ? m.backward_quantity : m.forward_quantity);
  if (tokenQty === null || xcpQty === null) return null;
  return { forwardIsToken, tokenQty, xcpQty };
}

function receives(
  event: string,
  address: string,
  asset: string,
  block: number,
  tokenQty: bigint,
  xcpQty: bigint,
  gainsToken: boolean,
): EventRow {
  return {
    // The asset belongs in the key: one transaction can move more than one
    // of them, and `event:address` alone would silently collapse those into
    // a single row via OR IGNORE.
    id: `${event}:${asset}:${address}`,
    event,
    address,
    asset,
    block,
    tokenDelta: gainsToken ? tokenQty : -tokenQty,
    xcpDelta: gainsToken ? -xcpQty : xcpQty,
    kind: gainsToken ? "buy" : "sell",
  };
}

/** A pool swap has ONE trader; the pool itself is the counterparty and has no
 *  address to attribute a position to. */
export function toPoolRows(asset: string, m: CpMatch): EventRow[] {
  const event = m.tx_hash ?? m.id;
  if (!event || !m.source) return [];
  const l = legs(asset, m);
  if (!l) return [];
  return [
    receives(event, m.source, asset, m.block_index, l.tokenQty, l.xcpQty, l.forwardIsToken),
  ];
}

/** An order-book fill has TWO traders, and both hold real positions. tx1
 *  receives `forward_asset`; tx0 is the other side of the same fill. Recording
 *  only tx1 would leave a user who was tx0 invisible — and a position that
 *  can't be reconstructed reports no PnL at all, so the omission would surface
 *  as a mysteriously withheld number rather than an obvious bug. */
export function toOrderRows(asset: string, m: CpMatch): EventRow[] {
  // Prefer the match's own id: it is make_id(tx0_hash, tx_hash), unique per
  // fill, whereas one order can be filled repeatedly.
  const event = m.id ?? m.tx1_hash ?? m.tx_hash;
  if (!event) return [];
  const l = legs(asset, m);
  if (!l) return [];
  const rows: EventRow[] = [];
  if (m.tx1_address) {
    rows.push(
      receives(event, m.tx1_address, asset, m.block_index, l.tokenQty, l.xcpQty, l.forwardIsToken),
    );
  }
  if (m.tx0_address && m.tx0_address !== m.tx1_address) {
    rows.push(
      receives(event, m.tx0_address, asset, m.block_index, l.tokenQty, l.xcpQty, !l.forwardIsToken),
    );
  }
  return rows;
}

/** D1 caps how much one batch can carry, and a first-run backfill can produce
 *  thousands of rows — send them in bounded chunks rather than one giant call. */
const INSERT_CHUNK = 100;

/**
 * At most one asset gets its history backfilled per tick.
 *
 * A backfill is the only pass here that isn't bounded by "what changed since
 * last time", and its cursor is written at the END. If several ran together
 * and the tick ran out of time, none of their cursors would land and the next
 * tick would repeat all of it — re-touching every row, which D1 bills whether
 * or not OR IGNORE ends up writing. Doing one at a time keeps each tick's
 * worst case small enough to finish, so every tick converts into permanent
 * progress instead of risking a loop that repeats forever.
 */
const FIRST_RUNS_PER_TICK = 1;

const cursorKey = (asset: string) => `events_hw:${asset}`;

export async function syncAssetEvents(
  db: D1Database,
  targets: GraduatedTarget[],
  height: number,
): Promise<number> {
  if (targets.length === 0) return 0;

  // Every cursor in ONE primary-key-ranged read. The obvious alternative —
  // MAX(block_index) WHERE asset = ? — has no index to use (this table is
  // indexed by address, and adding a second index would tax every insert), so
  // it would scan the whole table once per asset per tick, growing without
  // bound as the table fills. A cursor row is O(1) forever.
  // A RANGE, not a LIKE. `key LIKE 'events_hw:%'` cannot use the primary key
  // and planned as a full SCAN of chain_state; the half-open range compiles to
  // an index seek (`key>? AND key<?`). Same rows, and it stays O(matches) as
  // the table grows a cursor per graduated asset. ';' is the character after
  // ':' in ASCII, so the upper bound is the tightest one that excludes nothing.
  const cursorRows = await q<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM chain_state WHERE key >= 'events_hw:' AND key < 'events_hw;'`,
  );
  const cursors = new Map(cursorRows.map((r) => [r.key, Number(r.value)]));

  let inserted = 0;
  let firstRuns = 0;

  for (const target of targets) {
    const known = cursors.get(cursorKey(target.asset));
    const firstRun = known === undefined;
    // An asset already caught up only gets looked at when its pool moved,
    // which is the only way a trade can have happened. First run is the
    // exception: a launch that graduated before this existed has a perfectly
    // unchanged reserve and would otherwise never be indexed at all.
    if (!firstRun && !target.poolChanged) continue;
    if (firstRun) {
      if (firstRuns >= FIRST_RUNS_PER_TICK) continue; // next tick takes it
      firstRuns += 1;
    }

    const sinceBlock = firstRun ? 0 : known;

    const [poolMatches, orderMatches] = await Promise.all([
      fetchPoolMatches(target.asset, sinceBlock),
      fetchOrderMatches(target.asset, sinceBlock),
    ]);

    const rows = [
      ...poolMatches.flatMap((m) => toPoolRows(target.asset, m)),
      ...orderMatches.flatMap((m) => toOrderRows(target.asset, m)),
    ];

    // Same fills, folded a second way. A pool match has one trader and a book
    // match has two, but as a PRICE each is exactly one fill — so candles come
    // from the matches themselves, not from the per-address event rows, which
    // would double-count every order-book trade.
    const fills = [...poolMatches, ...orderMatches].flatMap<Fill>((m) => {
      const forwardIsToken = m.forward_asset === target.asset;
      const xcp = rawInt(forwardIsToken ? m.backward_quantity : m.forward_quantity);
      const token = rawInt(forwardIsToken ? m.forward_quantity : m.backward_quantity);
      if (xcp === null || token === null || !m.block_time) return [];
      return [{ time: m.block_time, block: m.block_index, xcp, token }];
    });
    if (fills.length > 0) {
      // A first run fetched from block 0, so every fill this asset ever had is
      // in hand and the fold is authoritative — there is nothing to merge onto,
      // and merging would double-count anything a half-finished earlier attempt
      // had already written. It is also the one pass where the read would be
      // expensive: a long-lived asset spans thousands of buckets.
      const stored = firstRun ? new Map() : await readCandles(db, target.asset, fills);
      await writeCandles(db, foldCandles(target.asset, fills, stored));
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO asset_events
           (id, event, address, asset, block_index, token_delta, xcp_delta, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      );
      const results = await db.batch(
        chunk.map((r) =>
          stmt.bind(
            r.id,
            r.event,
            r.address,
            r.asset,
            r.block,
            r.tokenDelta.toString(),
            r.xcpDelta.toString(),
            r.kind,
          ),
        ),
      );
      inserted += results.reduce((sum, res) => sum + (res.meta.rows_written ?? 0), 0);
    }

    // Always advance the cursor, even when nothing was found. Without this an
    // asset that has never traded would look like a first run forever and
    // re-read both feeds on every single tick.
    const seen = rows.reduce((max, r) => (r.block > max ? r.block : max), sinceBlock);
    const next = Math.min(Math.max(seen, sinceBlock), height);
    if (next !== known) {
      await db
        .prepare(
          `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value
             WHERE chain_state.value IS NOT excluded.value`,
        )
        .bind(cursorKey(target.asset), String(next))
        .run();
    }
  }

  return inserted;
}

/**
 * The buckets these fills land in, as they currently stand.
 *
 * Bounded by the fills themselves — an incremental tick touches one or two
 * buckets per resolution, so this is a handful of rows read by primary key,
 * not a scan. A first-run backfill of a long-lived asset is the exception, and
 * it happens once per asset, ever.
 */
async function readCandles(db: D1Database, asset: string, fills: Fill[]): Promise<Stored> {
  const ids = [...new Set(fills.flatMap((f) => bucketIds(asset, f.time).map((b) => b.id)))];
  const stored: Stored = new Map();
  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    const chunk = ids.slice(i, i + INSERT_CHUNK);
    const rows = await q<{
      id: string;
      asset: string;
      resolution: string;
      bucket_start: number;
      open: string;
      high: string;
      low: string;
      close: string;
      volume_xcp: string;
      trades: number;
      last_block: number;
    }>(
      db,
      `SELECT id, asset, resolution, bucket_start, open, high, low, close, volume_xcp, trades, last_block
         FROM price_candles
        WHERE id IN (${chunk.map(() => "?").join(",")})`,
      ...chunk,
    );
    for (const r of rows) {
      stored.set(r.id, {
        id: r.id,
        asset: r.asset,
        resolution: r.resolution,
        bucketStart: r.bucket_start,
        open: BigInt(r.open),
        high: BigInt(r.high),
        low: BigInt(r.low),
        close: BigInt(r.close),
        volume: BigInt(r.volume_xcp),
        trades: r.trades,
        lastBlock: r.last_block,
      });
    }
  }
  return stored;
}

/**
 * Upsert touched buckets, delta-guarded.
 *
 * A bucket is rewritten only while fills can still land in it. The guard is
 * what keeps that honest: re-running with the same fills produces identical
 * values, the WHERE clause matches nothing, and D1 bills no write. Without
 * it, every tick would rewrite the newest bucket forever — small, but
 * unbounded in time, which is exactly the shape that runs up a bill.
 */
async function writeCandles(db: D1Database, candles: Candle[]): Promise<void> {
  for (let i = 0; i < candles.length; i += INSERT_CHUNK) {
    const chunk = candles.slice(i, i + INSERT_CHUNK);
    const stmt = db.prepare(
      // The excluded values are already MERGED — foldCandles folded the new
      // fills onto the stored row — so this assigns rather than accumulates.
      // Accumulating in SQL would double-count the moment a batch retried.
      `INSERT INTO price_candles
         (id, asset, resolution, bucket_start, open, high, low, close, volume_xcp, trades, last_block)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(id) DO UPDATE SET
         high = excluded.high,
         low = excluded.low,
         close = excluded.close,
         volume_xcp = excluded.volume_xcp,
         trades = excluded.trades,
         last_block = excluded.last_block
       WHERE price_candles.high IS NOT excluded.high
          OR price_candles.low IS NOT excluded.low
          OR price_candles.close IS NOT excluded.close
          OR price_candles.volume_xcp IS NOT excluded.volume_xcp
          OR price_candles.trades IS NOT excluded.trades
          OR price_candles.last_block IS NOT excluded.last_block`,
    );
    await db.batch(
      chunk.map((c) =>
        stmt.bind(
          c.id,
          c.asset,
          c.resolution,
          c.bucketStart,
          c.open.toString(),
          c.high.toString(),
          c.low.toString(),
          c.close.toString(),
          c.volume.toString(),
          c.trades,
          c.lastBlock,
        ),
      ),
    );
  }
}
