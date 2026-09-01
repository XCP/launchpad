import { q } from "#api/db";
import {
  fetchAllAssetDestructions,
  fetchAllAddressReceives,
  fetchAddressReceives,
  fetchAssetDestructions,
  type CpAddressReceive,
  type CpAssetDestructionEvent,
} from "#api/integrations/counterparty";
import {
  lpBurned,
  tokenBurned,
  type Announcement,
} from "#api/telegram/format";
export const COUNTERPARTY_BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const CURSOR_KEY = "telegram_burn_receive_tx_index";
const DESTRUCTION_CURSOR_KEY = "telegram_asset_destruction_event_index";
// Versioned because v1 incorrectly seeded from this address's live balance,
// while v2 included SENDs but missed explicit ASSET_DESTRUCTION events.
const SUPPLY_SEED_KEY = "burned_supply_from_chain_events_seeded";
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
  nextDestructionCursor: number | null;
  seeded: boolean;
}

const txIndex = (row: CpAddressReceive) => Number(row.tx_index);
const burnKey = (row: CpAddressReceive) =>
  `burn:${row.tx_hash}:${row.msg_index}:${row.asset}`;

interface IndexedBurn {
  key: string;
  tx_hash: string;
  tx_index: number;
  msg_index: number;
  block_index: number;
  source: string;
  destination: string;
  asset: string;
  quantity: number | string;
}

const sendBurn = (row: CpAddressReceive): IndexedBurn => ({
  key: burnKey(row),
  tx_hash: row.tx_hash,
  tx_index: row.tx_index,
  msg_index: row.msg_index,
  block_index: row.block_index,
  source: row.source,
  destination: row.destination,
  asset: row.asset,
  quantity: row.quantity,
});

const destructionBurn = (row: CpAssetDestructionEvent): IndexedBurn => ({
  key: `destroy:${row.event_index}:${row.params.asset}`,
  tx_hash: row.params.tx_hash || row.tx_hash || `event:${row.event_index}`,
  tx_index: row.params.tx_index,
  // event_index is globally unique and preserves deterministic ordering.
  msg_index: row.event_index,
  block_index: row.params.block_index,
  source: row.params.source,
  destination: COUNTERPARTY_BURN_ADDRESS,
  asset: row.params.asset,
  quantity: row.params.quantity,
});

async function recordBurns(db: D1Database, rows: IndexedBurn[]): Promise<void> {
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
          row.key,
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

/** Replace every indexed launch's burn amount with confirmed SENDs to the
 * canonical address plus explicit ASSET_DESTRUCTION events recorded for that
 * incarnation. A canonical-address balance is not evidence of either. */
export async function reconcileBurnedSupply(db: D1Database): Promise<void> {
  // Keep the sum inside SQLite's exact int64 arithmetic. The tx-index clause
  // matters when a ticker is relaunched: burns that cleared the old issuance
  // cannot reduce the new launch's 100M supply.
  await db.prepare(
    `UPDATE launches
        SET burned_quantity = CAST(COALESCE((
          SELECT SUM(CAST(token_burns.quantity AS INTEGER))
            FROM token_burns
           WHERE token_burns.asset = launches.asset
             AND token_burns.tx_index > launches.tx_index
        ), 0) AS TEXT)`,
  ).run();
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    )
    .bind(SUPPLY_SEED_KEY)
    .run();
}

export const isConfirmedBurnSend = (row: CpAddressReceive): boolean => {
  if (
    row.destination !== COUNTERPARTY_BURN_ADDRESS ||
    row.status !== "valid" ||
    row.send_type !== "send"
  ) {
    return false;
  }
  try {
    return BigInt(String(row.quantity)) > 0n;
  } catch {
    return false;
  }
};

export const isConfirmedAssetDestruction = (
  row: CpAssetDestructionEvent,
): boolean => {
  if (
    row.event !== "ASSET_DESTRUCTION" ||
    row.params.status !== "valid" ||
    row.params.asset.length === 0 ||
    !Number.isFinite(Number(row.params.tx_index))
  ) {
    return false;
  }
  try {
    return BigInt(String(row.params.quantity)) > 0n;
  } catch {
    return false;
  }
};

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

/** One-time history seed for supply math. This records both genuine SENDs and
 * explicit destroy messages without replaying old announcements to Telegram. */
async function seedBurnEvents(db: D1Database): Promise<void> {
  const validSends = (await fetchAllAddressReceives(COUNTERPARTY_BURN_ADDRESS))
    .filter(isConfirmedBurnSend);
  const validDestructions = (await fetchAllAssetDestructions())
    .filter(isConfirmedAssetDestruction);
  const assets = [...new Set([
    ...validSends.map((row) => row.asset),
    ...validDestructions.map((row) => row.params.asset),
  ])];
  const covered = assets.length > 0
    ? await coveredBurns(db, assets)
    : new Map<string, CoveredBurn>();
  await recordBurns(
    db,
    [
      ...validSends
        .filter((row) => covered.get(row.asset)?.kind === "token")
        .map(sendBurn),
      ...validDestructions
        // LP destruction is routine during pool withdrawal. It neither burns
        // launch-token supply nor proves the remaining liquidity is locked.
        .filter((row) => covered.get(row.params.asset)?.kind === "token")
        .map(destructionBurn),
    ],
  );
  await reconcileBurnedSupply(db);
}

/** Find newly confirmed supply reductions: launch-token SENDs to the canonical
 * address and explicit Counterparty destroy messages. LP SENDs remain a
 * distinct liquidity-lock announcement; routine LP destructions are ignored. */
export async function scanBurnReceives(db: D1Database): Promise<BurnScan> {
  const state = await q<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM chain_state WHERE key IN (?1, ?2, ?3)`,
    CURSOR_KEY,
    DESTRUCTION_CURSOR_KEY,
    SUPPLY_SEED_KEY,
  );
  const states = new Map(state.map((row) => [row.key, row.value]));
  const receiveValue = states.get(CURSOR_KEY);
  const receiveStored = receiveValue === undefined ? null : Number(receiveValue);
  const destructionValue = states.get(DESTRUCTION_CURSOR_KEY);
  const destructionStored = destructionValue === undefined
    ? null
    : Number(destructionValue);
  let reconciled = false;
  if (states.get(SUPPLY_SEED_KEY) !== "1") {
    await seedBurnEvents(db);
    reconciled = true;
  }

  // Two one-row probes are the entire foreign read on a normal quiet tick.
  const latestReceives = await fetchAddressReceives(COUNTERPARTY_BURN_ADDRESS, 1);
  const latestReceive = latestReceives.result[0];
  let nextCursor = receiveStored;
  const freshSends = new Map<string, CpAddressReceive>();
  if (latestReceive) {
    const newest = txIndex(latestReceive);
    nextCursor = newest > (receiveStored ?? -1) ? newest : receiveStored;
    if (receiveStored !== null && newest > receiveStored) {
      let cursor: number | undefined;
      let reachedStored = false;
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
        const page = await fetchAddressReceives(
          COUNTERPARTY_BURN_ADDRESS,
          PAGE_SIZE,
          cursor,
        );
        for (const row of page.result) {
          if (txIndex(row) <= receiveStored) {
            reachedStored = true;
            continue;
          }
          freshSends.set(`${row.tx_hash}:${row.msg_index}:${row.asset}`, row);
        }
        if (reachedStored || page.next_cursor === null) break;
        cursor = page.next_cursor;
        if (pageNumber === MAX_PAGES - 1) {
          throw new Error("Burn receive pagination exceeded safety limit; cursor not advanced");
        }
      }
    }
  }

  const latestDestructions = await fetchAssetDestructions(1);
  const latestDestruction = latestDestructions.result[0];
  let nextDestructionCursor = destructionStored;
  const freshDestructions = new Map<number, CpAssetDestructionEvent>();
  if (latestDestruction) {
    const newest = latestDestruction.event_index;
    nextDestructionCursor = newest > (destructionStored ?? -1)
      ? newest
      : destructionStored;
    if (destructionStored !== null && newest > destructionStored) {
      let cursor: number | undefined;
      let reachedStored = false;
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
        const page = await fetchAssetDestructions(PAGE_SIZE, cursor);
        for (const row of page.result) {
          if (row.event_index <= destructionStored) {
            reachedStored = true;
            continue;
          }
          freshDestructions.set(row.event_index, row);
        }
        if (reachedStored || page.next_cursor === null) break;
        cursor = page.next_cursor;
        if (pageNumber === MAX_PAGES - 1) {
          throw new Error("Asset destruction pagination exceeded safety limit; cursor not advanced");
        }
      }
    }
  }

  const validSends = [...freshSends.values()].filter(isConfirmedBurnSend);
  const validDestructions = [...freshDestructions.values()]
    .filter(isConfirmedAssetDestruction);
  const assets = [...new Set([
    ...validSends.map((row) => row.asset),
    ...validDestructions.map((row) => row.params.asset),
  ])];
  const covered = assets.length > 0
    ? await coveredBurns(db, assets)
    : new Map<string, CoveredBurn>();

  validSends.sort((a, b) => txIndex(a) - txIndex(b) || a.msg_index - b.msg_index);
  const matchingSends = validSends.flatMap((row) => {
    const match = covered.get(row.asset);
    return match ? [{ row, match }] : [];
  });
  validDestructions.sort((a, b) =>
    a.params.tx_index - b.params.tx_index || a.event_index - b.event_index
  );
  const matchingDestructions = validDestructions.filter(
    (row) => covered.get(row.params.asset)?.kind === "token",
  );
  // /activity's burn count is a circulating-supply measure. LP SENDs can be
  // announced as locks but are excluded; LP destroys from withdrawals are
  // neither supply burns nor locks and are ignored entirely.
  const tokenBurns: IndexedBurn[] = [
    ...matchingSends
    .filter(({ match }) => match.kind === "token")
      .map(({ row }) => sendBurn(row)),
    ...matchingDestructions.map(destructionBurn),
  ];
  await recordBurns(db, tokenBurns);
  if (tokenBurns.length > 0 && !reconciled) await reconcileBurnedSupply(db);
  const announcements = [
    ...matchingSends.map(({ row, match }) => ({
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
    })),
    ...matchingDestructions.map((row) => ({
      key: destructionBurn(row).key,
      a: tokenBurned({
        asset: row.params.asset,
        tokenRaw: BigInt(String(row.params.quantity)),
        source: row.params.source,
        txHash: row.params.tx_hash,
        method: "destroy",
      }),
    })),
  ];

  return {
    announcements,
    nextCursor,
    nextDestructionCursor,
    seeded: receiveStored === null && destructionStored === null,
  };
}

/** Monotonic even if a retry races another caller after durable acceptance. */
export async function advanceBurnCursor(
  db: D1Database,
  nextCursor: number | null,
  nextDestructionCursor?: number | null,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (nextCursor !== null) {
    statements.push(db.prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CAST(excluded.value AS INTEGER) > CAST(chain_state.value AS INTEGER)`,
    ).bind(CURSOR_KEY, String(nextCursor)));
  }
  if (nextDestructionCursor !== undefined && nextDestructionCursor !== null) {
    statements.push(db.prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CAST(excluded.value AS INTEGER) > CAST(chain_state.value AS INTEGER)`,
    ).bind(DESTRUCTION_CURSOR_KEY, String(nextDestructionCursor)));
  }
  if (statements.length > 0) await db.batch(statements);
}
