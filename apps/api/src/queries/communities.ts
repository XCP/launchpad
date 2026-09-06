import { one, q } from "#api/db";

export type CommunityRole = "creator" | "holder";

export interface CommunityMembership {
  address: string;
  tag: string;
  role: CommunityRole;
  cards: number;
}

/** Every address that has minted a conforming launch. The set only grows. */
export async function listMinterAddresses(db: D1Database): Promise<string[]> {
  const rows = await q<{ source: string }>(
    db,
    `SELECT DISTINCT m.source
       FROM launch_mints m
       JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
      ORDER BY m.source`,
  );
  return rows.map((r) => r.source);
}

/** Rows written: only those whose card count changed or that did not exist. */
export async function upsertCommunities(db: D1Database, fresh: CommunityMembership[]): Promise<number> {
  if (fresh.length === 0) return 0;
  const res = await db
    .prepare(
      `INSERT INTO address_communities (address, tag, role, cards)
       SELECT json_extract(value, '$.address'), json_extract(value, '$.tag'),
              json_extract(value, '$.role'), json_extract(value, '$.cards')
         FROM json_each(?1)
        WHERE true
       ON CONFLICT (address, tag, role) DO UPDATE SET cards = excluded.cards
       WHERE address_communities.cards IS NOT excluded.cards`,
    )
    .bind(JSON.stringify(fresh))
    .run();
  return res.meta.rows_written ?? 0;
}

/** Rows for these addresses that the fresh answer no longer contains. */
export async function pruneCommunities(
  db: D1Database,
  addresses: string[],
  fresh: CommunityMembership[],
): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM address_communities
        WHERE address IN (SELECT value FROM json_each(?1))
          AND NOT EXISTS (
            SELECT 1 FROM json_each(?2) f
             WHERE json_extract(f.value, '$.address') = address_communities.address
               AND json_extract(f.value, '$.tag') = address_communities.tag
               AND json_extract(f.value, '$.role') = address_communities.role)`,
    )
    .bind(JSON.stringify(addresses), JSON.stringify(fresh))
    .run();
  return res.meta.rows_written ?? 0;
}

const SYNCED_KEY = "communities_synced_at";

export async function communitiesSyncedAt(db: D1Database): Promise<number | null> {
  const row = await one<{ value: string }>(db, `SELECT value FROM chain_state WHERE key = ?1`, SYNCED_KEY);
  return row ? Number(row.value) : null;
}

export async function markCommunitiesSynced(db: D1Database, at: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE chain_state.value IS NOT excluded.value`,
    )
    .bind(SYNCED_KEY, String(at))
    .run();
}

export interface CommunityLaunchRow {
  tag: string;
  asset: string;
  /** Distinct minters of this launch who belong to the community. */
  minters: number;
}

/** The raw facts the /v2/communities aggregate is built from. A community's
 *  top launch is chosen among graduated ones only: a launch still minting or
 *  refunded is not somewhere a community ended up. */
export async function communityFacts(db: D1Database): Promise<{
  memberships: Omit<CommunityMembership, "cards">[];
  byLaunch: CommunityLaunchRow[];
  launchMinters: { asset: string; minters: number }[];
  minters: number;
}> {
  const [memberships, byLaunch, launchMinters, total] = await Promise.all([
    q<Omit<CommunityMembership, "cards">>(db, `SELECT address, tag, role FROM address_communities`),
    q<CommunityLaunchRow>(
      db,
      `SELECT member.tag, l.asset, COUNT(DISTINCT m.source) AS minters
         FROM (SELECT DISTINCT address, tag FROM address_communities) member
         JOIN launch_mints m ON m.source = member.address
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1 AND l.phase = 'graduated'
        GROUP BY member.tag, l.asset`,
    ),
    q<{ asset: string; minters: number }>(
      db,
      `SELECT l.asset, COUNT(DISTINCT m.source) AS minters
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1 AND l.phase = 'graduated'
        GROUP BY l.asset`,
    ),
    one<{ n: number }>(
      db,
      `SELECT COUNT(DISTINCT m.source) AS n
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1`,
    ),
  ]);
  return { memberships, byLaunch, launchMinters, minters: total?.n ?? 0 };
}
