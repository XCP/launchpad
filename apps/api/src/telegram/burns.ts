import { q } from "#api/db";
import {
  fetchAddressReceives,
  type CpAddressReceive,
} from "#api/integrations/counterparty";
import { tokenBurned, type Announcement } from "#api/telegram/format";

export const COUNTERPARTY_BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const CURSOR_KEY = "telegram_burn_receive_tx_index";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export interface BurnAnnouncement {
  key: string;
  a: Announcement;
}

export interface BurnScan {
  announcements: BurnAnnouncement[];
  /** Persist only after every matching message has reached the durable queue. */
  nextCursor: number | null;
  seeded: boolean;
}

const txIndex = (row: CpAddressReceive) => Number(row.tx_index);
const burnKey = (row: CpAddressReceive) =>
  `burn:${row.tx_hash}:${row.msg_index}:${row.asset}`;

async function recordBurns(db: D1Database, rows: CpAddressReceive[]): Promise<void> {
  if (rows.length === 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO token_burns
       (key, tx_hash, tx_index, msg_index, block_index, source, destination, asset, quantity)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  );
  // D1 batches are deliberately kept small. A normal run is one row; this
  // bound also makes recovery after a long outage predictable.
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(
      rows.slice(i, i + 50).map((row) =>
        insert.bind(
          burnKey(row),
          row.tx_hash,
          row.tx_index,
          row.msg_index,
          row.block_index,
          row.source,
          row.destination,
          row.asset,
          String(row.quantity),
        ),
      ),
    );
  }
}

async function coveredAssets(db: D1Database, assets: string[]): Promise<Set<string>> {
  const covered = new Set<string>();
  for (let i = 0; i < assets.length; i += 50) {
    const chunk = assets.slice(i, i + 50);
    const placeholders = chunk.map((_, n) => `?${n + 1}`).join(", ");
    const rows = await q<{ asset: string }>(
      db,
      `SELECT DISTINCT asset
         FROM launches
        WHERE conforming = 1 AND asset IN (${placeholders})`,
      ...chunk,
    );
    for (const row of rows) covered.add(row.asset);
  }
  return covered;
}

/**
 * Find newly confirmed xcp.fun assets sent to Counterparty's canonical burn
 * address. The first run seeds at the current newest receive so deploying the
 * feature cannot replay the address's historical burns into Telegram.
 */
export async function scanBurnReceives(db: D1Database): Promise<BurnScan> {
  const state = await q<{ value: string }>(
    db,
    `SELECT value FROM chain_state WHERE key = ?1`,
    CURSOR_KEY,
  );
  const stored = state[0] ? Number(state[0].value) : null;

  // A one-row probe is the entire foreign read on the normal quiet tick.
  const latestPage = await fetchAddressReceives(COUNTERPARTY_BURN_ADDRESS, 1);
  const latest = latestPage.result[0];
  if (!latest) return { announcements: [], nextCursor: stored, seeded: stored === null };
  const newest = txIndex(latest);

  if (stored === null) {
    return { announcements: [], nextCursor: newest, seeded: true };
  }
  if (newest <= stored) {
    return { announcements: [], nextCursor: stored, seeded: false };
  }

  const fresh = new Map<string, CpAddressReceive>();
  let cursor: number | undefined;
  let reachedStored = false;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const page = await fetchAddressReceives(
      COUNTERPARTY_BURN_ADDRESS,
      PAGE_SIZE,
      cursor,
    );
    for (const row of page.result) {
      if (txIndex(row) <= stored) {
        reachedStored = true;
        continue;
      }
      fresh.set(`${row.tx_hash}:${row.msg_index}:${row.asset}`, row);
    }
    if (reachedStored || page.next_cursor === null) break;
    cursor = page.next_cursor;
    if (pageNumber === MAX_PAGES - 1) {
      throw new Error("Burn receive pagination exceeded safety limit; cursor not advanced");
    }
  }

  const valid = [...fresh.values()].filter((row) => {
    if (row.destination !== COUNTERPARTY_BURN_ADDRESS || row.status !== "valid") return false;
    try {
      return BigInt(String(row.quantity)) > 0n;
    } catch {
      return false;
    }
  });
  const assets = [...new Set(valid.map((row) => row.asset))];
  const covered = assets.length > 0 ? await coveredAssets(db, assets) : new Set<string>();

  valid.sort((a, b) => txIndex(a) - txIndex(b) || a.msg_index - b.msg_index);
  const matching = valid.filter((row) => covered.has(row.asset));
  await recordBurns(db, matching);
  const announcements = matching
    .map((row) => ({
      key: burnKey(row),
      a: tokenBurned({
        asset: row.asset,
        tokenRaw: BigInt(String(row.quantity)),
        source: row.source,
        txHash: row.tx_hash,
      }),
    }));

  return { announcements, nextCursor: newest, seeded: false };
}

/** Monotonic even if a retry races another caller after durable acceptance. */
export async function advanceBurnCursor(
  db: D1Database,
  nextCursor: number | null,
): Promise<void> {
  if (nextCursor === null) return;
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CAST(excluded.value AS INTEGER) > CAST(chain_state.value AS INTEGER)`,
    )
    .bind(CURSOR_KEY, String(nextCursor))
    .run();
}
