/**
 * Mirroring the order book into D1.
 *
 * This exists to delete a fan-out. /v2/activity/orders used to ask
 * Counterparty for one market's whole order history per edge-cache miss,
 * because orders are the one thing this database did not know — and that cost
 * grew with the site's success, one subrequest per graduated launch, forever.
 * Moving it here makes it a cron's problem instead of a reader's, and a cron
 * can be gated in ways a request cannot.
 *
 * The gate is the whole design. An order is nearly immutable: its remaining
 * quantity falls as it fills and its status goes terminal, and then it never
 * changes again. So the overwhelmingly common tick is one where NOTHING has
 * changed for a market, and that tick must be cheap — not "cheap because the
 * delta guard writes nothing", but cheap because it never issues the
 * statements at all. D1 bills every row a statement touches whether or not the
 * value changed, and a per-market upsert of every order that market has ever
 * had, every five minutes, forever, is precisely the shape this project has a
 * standing rule against.
 *
 * So each market's fetched book is hashed, and the hash is compared against
 * the one stored from last time. Unchanged — the normal case — costs one
 * primary-key read and stops. Changed, which happens a handful of times a day
 * per market, costs one batch of delta-guarded upserts over that market's
 * orders. Nothing else reads this table.
 *
 * Why a digest rather than a cursor: a cursor works for append-only feeds,
 * where new rows only ever arrive at one end. Orders mutate in the middle —
 * an order opened a week ago can fill today without any newer order existing —
 * so "everything past tx_index N" cannot express what changed. A hash of the
 * mutable state can.
 */
import { one, q } from "#api/db";
import { fetchAssetOrders, type CpOrder } from "#api/integrations/counterparty";

/**
 * Politeness bound on the fan-out, not a claim about how many markets exist.
 * One request per market per tick, and the caller reports covered-vs-total so
 * a capped pass is visible in the job log rather than silently partial.
 * Markets arrive deepest-pool-first, so the cap always keeps the busiest.
 */
const MAX_MARKETS_PER_TICK = 50;

/** D1 caps how much one batch can carry, and a market's first pass can be its
 *  entire history. Same bound the events indexer uses. */
const UPSERT_CHUNK = 100;

const digestKey = (asset: string) => `orders_digest:${asset}`;

export interface OrderSyncResult {
  markets: number;
  markets_read: number;
  markets_changed: number;
  rows_written: number;
  failed: number;
}

interface OrderRow {
  txHash: string;
  txIndex: number;
  blockIndex: number;
  source: string;
  asset: string;
  side: "buy" | "sell";
  tokenQuantity: string;
  xcpQuantity: string;
  tokenRemaining: string;
  xcpRemaining: string;
  status: string;
  expireIndex: number;
}

/**
 * One market's orders against XCP, in the shape this table stores.
 *
 * Orders whose pair is not TOKEN/XCP are dropped here rather than stored and
 * filtered later: they cannot be priced in the denomination the rest of the
 * site quotes, so a row for one would be a row nothing can ever display.
 */
function toRows(asset: string, orders: CpOrder[]): OrderRow[] {
  const rows: OrderRow[] = [];
  for (const o of orders) {
    const buying = o.give_asset === "XCP";
    // Exactly one leg must be XCP. Without this an order swapping two launch
    // tokens would be stored as if the other side were XCP satoshi.
    if (buying === (o.get_asset === "XCP")) continue;
    if ((buying ? o.get_asset : o.give_asset) !== asset) continue;
    rows.push({
      txHash: o.tx_hash,
      txIndex: o.tx_index,
      blockIndex: o.block_index,
      source: o.source,
      asset,
      side: buying ? "buy" : "sell",
      tokenQuantity: String(buying ? o.get_quantity : o.give_quantity),
      xcpQuantity: String(buying ? o.give_quantity : o.get_quantity),
      tokenRemaining: String(buying ? o.get_remaining : o.give_remaining),
      xcpRemaining: String(buying ? o.give_remaining : o.get_remaining),
      status: o.status,
      expireIndex: o.expire_index,
    });
  }
  return rows;
}

/**
 * A fingerprint of everything about this market's book that can change.
 *
 * Only the mutable fields plus identity — the immutable half (source, original
 * quantities, block) cannot differ for a tx_hash we already have, so including
 * it would only make the hash more expensive to compute and no more sensitive.
 * Sorted, because Counterparty's ordering is not part of the state and a
 * reordering must not read as a change.
 *
 * SHA-256 rather than a cheap string hash: a collision here is a change this
 * indexer never notices, and the cost of being sure is a few microseconds on
 * data measured in tens of rows.
 */
async function digest(rows: OrderRow[]): Promise<string> {
  const canonical = rows
    .map((r) => `${r.txHash}:${r.status}:${r.tokenRemaining}:${r.xcpRemaining}`)
    .sort()
    .join("\n");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mirror the order book for every market that has one.
 *
 * `assets` is the caller's worklist — graduated launches, deepest first. An
 * XCP-69 token does not exist before its launch closes, so no other launch can
 * have an order against it and asking would be a request guaranteed to return
 * nothing.
 *
 * A market that fails to read is skipped, not fatal: its digest is left alone,
 * so the next tick simply tries again and nothing is recorded as having been
 * checked when it wasn't.
 */
export async function syncOrders(
  db: D1Database,
  assets: string[],
): Promise<OrderSyncResult> {
  const worklist = assets.slice(0, MAX_MARKETS_PER_TICK);
  const result: OrderSyncResult = {
    markets: assets.length,
    markets_read: 0,
    markets_changed: 0,
    rows_written: 0,
    failed: 0,
  };
  if (worklist.length === 0) return result;

  // Every digest in ONE primary-key-ranged read, for the reason events.ts
  // spells out: a RANGE seeks the primary key where a LIKE would scan
  // chain_state end to end. ';' is the character after ':' in ASCII, so this
  // is the tightest upper bound that excludes nothing.
  const stored = new Map(
    (
      await q<{ key: string; value: string }>(
        db,
        `SELECT key, value FROM chain_state
          WHERE key >= 'orders_digest:' AND key < 'orders_digest;'`,
      )
    ).map((r) => [r.key, r.value]),
  );

  const books = await Promise.all(
    worklist.map((asset) =>
      fetchAssetOrders(asset)
        .then((orders) => ({ asset, orders }))
        .catch(() => null),
    ),
  );

  for (const book of books) {
    if (!book) {
      result.failed += 1;
      continue;
    }
    result.markets_read += 1;

    const rows = toRows(book.asset, book.orders);
    const fingerprint = await digest(rows);
    // The gate. Unchanged is the normal tick, and it ends here having touched
    // one chain_state row and nothing in `orders` at all.
    if (stored.get(digestKey(book.asset)) === fingerprint) continue;

    result.markets_changed += 1;

    // Delta-guarded, so the rows that did not change cost a comparison rather
    // than a write. Only the three mutable columns are compared: the rest of
    // the row is immutable for a given tx_hash, so testing it could only ever
    // produce a false positive.
    const stmt = db.prepare(
      `INSERT INTO orders
         (tx_hash, tx_index, block_index, source, asset, side,
          token_quantity, xcp_quantity, expire_index,
          token_remaining, xcp_remaining, status, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(tx_hash) DO UPDATE SET
         token_remaining = excluded.token_remaining,
         xcp_remaining   = excluded.xcp_remaining,
         status          = excluded.status,
         updated_at      = excluded.updated_at
       WHERE orders.status IS NOT excluded.status
          OR orders.token_remaining IS NOT excluded.token_remaining
          OR orders.xcp_remaining IS NOT excluded.xcp_remaining`,
    );
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const results = await db.batch(
        rows.slice(i, i + UPSERT_CHUNK).map((r) =>
          stmt.bind(
            r.txHash,
            r.txIndex,
            r.blockIndex,
            r.source,
            r.asset,
            r.side,
            r.tokenQuantity,
            r.xcpQuantity,
            r.expireIndex,
            r.tokenRemaining,
            r.xcpRemaining,
            r.status,
            now,
          ),
        ),
      );
      result.rows_written += results.reduce((n, res) => n + (res.meta.rows_written ?? 0), 0);
    }

    // Written only AFTER the rows land. A digest stored before a failed batch
    // would mark this market as up to date while D1 still held the old book,
    // and nothing would ever correct it — the next tick would compare the same
    // unchanged fingerprint and skip.
    await db
      .prepare(
        `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value
           WHERE chain_state.value IS NOT excluded.value`,
      )
      .bind(digestKey(book.asset), fingerprint)
      .run();
  }

  return result;
}

/** How many orders are mirrored, for the tape's tab count. Two shapes because
 *  "Hide filled" asks a different question and has its own partial index. */
export function countOrders(db: D1Database, liveOnly: boolean): Promise<{ n: number } | null> {
  return one<{ n: number }>(
    db,
    liveOnly
      ? `SELECT COUNT(*) AS n FROM orders WHERE status = 'open'`
      : `SELECT COUNT(*) AS n FROM orders`,
  );
}
