import { q } from "#api/db";
import {
  fetchAddressBalances,
  fetchAddressReceives,
  type CpAddressReceive,
} from "#api/integrations/counterparty";
import {
  lpBurned,
  tokenBurned,
  type Announcement,
} from "#api/telegram/format";
import {
  netBurnedSupplyRaw,
  type LaunchPhase,
} from "@launchpad/xcp69/xcp69";

export const COUNTERPARTY_BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const CURSOR_KEY = "telegram_burn_receive_tx_index";
const SUPPLY_SEED_KEY = "burned_supply_seeded";
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

/** Replace every indexed launch's burn amount with Counterparty's current
 * balance at the canonical unspendable address. Absolute reconciliation avoids
 * both historical gaps and double-counting across retries. It runs once at
 * rollout, then only on a tick that actually observed a new token burn. */
async function reconcileBurnedSupply(db: D1Database): Promise<void> {
  const balances = await fetchAddressBalances(COUNTERPARTY_BURN_ADDRESS);
  const burned = new Map<string, bigint>();
  for (const row of balances) {
    let quantity: bigint;
    try {
      quantity = BigInt(String(row.quantity));
    } catch {
      continue;
    }
    if (quantity <= 0n) continue;
    burned.set(row.asset, (burned.get(row.asset) ?? 0n) + quantity);
  }

  const launches = await q<{
    tx_hash: string;
    asset: string;
    phase: LaunchPhase;
    pool_quantity: string | null;
  }>(
    db,
    `SELECT tx_hash, asset, phase, pool_quantity FROM launches`,
  );
  const update = db.prepare(
    `UPDATE launches
        SET burned_quantity = ?1
      WHERE tx_hash = ?2 AND burned_quantity IS NOT ?1`,
  );
  for (let i = 0; i < launches.length; i += 50) {
    await db.batch(
      launches.slice(i, i + 50).map((launch) => {
        const quantity = netBurnedSupplyRaw(
          burned.get(launch.asset) ?? 0n,
          launch.pool_quantity ?? 0,
          launch.phase,
        );
        return update.bind(String(quantity), launch.tx_hash);
      }),
    );
  }
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    )
    .bind(SUPPLY_SEED_KEY)
    .run();
}

interface CoveredBurn {
  launchAsset: string;
  kind: "token" | "lp";
}

/** Match both sides explicitly. Numeric asset names are not enough to prove
 * something is an LP; launches.lp_asset is the protocol relationship that
 * lets us announce the burn as locked liquidity for the right launch. */
async function coveredBurns(
  db: D1Database,
  assets: string[],
): Promise<Map<string, CoveredBurn>> {
  const covered = new Map<string, CoveredBurn>();
  for (let i = 0; i < assets.length; i += 50) {
    const chunk = assets.slice(i, i + 50);
    const wanted = new Set(chunk);
    const assetPlaceholders = chunk.map((_, n) => `?${n + 1}`).join(", ");
    const lpPlaceholders = chunk
      .map((_, n) => `?${chunk.length + n + 1}`)
      .join(", ");
    const rows = await q<{ asset: string; lp_asset: string | null }>(
      db,
      `SELECT asset, lp_asset
         FROM launches
        WHERE conforming = 1
          AND (asset IN (${assetPlaceholders}) OR lp_asset IN (${lpPlaceholders}))`,
      ...chunk,
      ...chunk,
    );
    for (const row of rows) {
      if (wanted.has(row.asset)) {
        covered.set(row.asset, { launchAsset: row.asset, kind: "token" });
      }
      if (row.lp_asset && wanted.has(row.lp_asset) && !covered.has(row.lp_asset)) {
        covered.set(row.lp_asset, { launchAsset: row.asset, kind: "lp" });
      }
    }
  }
  return covered;
}

/**
 * Find newly confirmed xcp.fun launch tokens and their recorded LP assets sent
 * to Counterparty's canonical burn address. The first run seeds at the current
 * newest receive so deploying the feature cannot replay the address's
 * historical burns into Telegram.
 */
export async function scanBurnReceives(db: D1Database): Promise<BurnScan> {
  const state = await q<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM chain_state WHERE key IN (?1, ?2)`,
    CURSOR_KEY,
    SUPPLY_SEED_KEY,
  );
  const states = new Map(state.map((row) => [row.key, row.value]));
  const storedValue = states.get(CURSOR_KEY);
  const stored = storedValue === undefined ? null : Number(storedValue);
  let reconciled = false;
  if (states.get(SUPPLY_SEED_KEY) !== "1") {
    await reconcileBurnedSupply(db);
    reconciled = true;
  }

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
  const covered = assets.length > 0
    ? await coveredBurns(db, assets)
    : new Map<string, CoveredBurn>();

  valid.sort((a, b) => txIndex(a) - txIndex(b) || a.msg_index - b.msg_index);
  const matching = valid.flatMap((row) => {
    const match = covered.get(row.asset);
    return match ? [{ row, match }] : [];
  });
  // /activity's token burn count is a circulating-supply measure. LP burns
  // are announced, but keeping them out of this table prevents a graduation
  // from looking like launch-token supply was destroyed.
  const tokenBurns = matching
    .filter(({ match }) => match.kind === "token")
    .map(({ row }) => row);
  await recordBurns(db, tokenBurns);
  if (tokenBurns.length > 0 && !reconciled) await reconcileBurnedSupply(db);
  const announcements = matching
    .map(({ row, match }) => ({
      key: burnKey(row),
      a: match.kind === "lp"
        ? lpBurned({
            asset: match.launchAsset,
            lpRaw: BigInt(String(row.quantity)),
            source: row.source,
            txHash: row.tx_hash,
          })
        : tokenBurned({
            asset: match.launchAsset,
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
