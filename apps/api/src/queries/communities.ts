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

export interface CommunityRow {
  tag: string;
  /** Minting addresses that created a card in the collection. */
  creators: number;
  /** Minting addresses that hold a card but created none. */
  collectors: number;
  /** Distinct minting addresses in either role. */
  members: number;
  /** The graduated launch this community is most present in, by share of that launch's minters. */
  top: { asset: string; minters: number; share: number } | null;
  /** XCP satoshi its members have committed to mints, as text. */
  paid_xcp: string;
}

export interface CommunityRollup {
  /** Every address that has minted a conforming launch. */
  minters: number;
  /** Of those, how many belong to at least one known collection. */
  represented: number;
  /** Distinct addresses that created a card anywhere. */
  creators: number;
  /** Distinct members that created nowhere. */
  collectors: number;
  /** XCP satoshi committed to every conforming mint, as text. */
  paid_xcp: string;
  communities: CommunityRow[];
}

/** A launch needs this many community minters before it can be a community's top launch. */
const TOP_FLOOR = 5;

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
  paidByTag: { tag: string; paid: string }[];
  paid: string;
}> {
  const [memberships, byLaunch, launchMinters, total, paidByTag, paidTotal] = await Promise.all([
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
    q<{ tag: string; paid: string }>(
      db,
      `SELECT member.tag, CAST(SUM(CAST(m.paid_quantity AS INTEGER)) AS TEXT) AS paid
         FROM (SELECT DISTINCT address, tag FROM address_communities) member
         JOIN launch_mints m ON m.source = member.address
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
        GROUP BY member.tag`,
    ),
    one<{ paid: string | null }>(
      db,
      `SELECT CAST(SUM(CAST(m.paid_quantity AS INTEGER)) AS TEXT) AS paid
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1`,
    ),
  ]);
  return {
    memberships,
    byLaunch,
    launchMinters,
    minters: total?.n ?? 0,
    paidByTag,
    paid: paidTotal?.paid ?? "0",
  };
}

/**
 * One row per collection: who created there, who collects there, and which
 * graduated launch drew the biggest share of its members. Ranked by share
 * rather than raw count so the largest launch does not top every row.
 */
export function rollUpCommunities(facts: Awaited<ReturnType<typeof communityFacts>>): CommunityRollup {
  const creators = new Map<string, Set<string>>();
  const holders = new Map<string, Set<string>>();
  const represented = new Set<string>();
  const anyCreator = new Set<string>();
  for (const m of facts.memberships) {
    const into = m.role === "creator" ? creators : holders;
    (into.get(m.tag) ?? into.set(m.tag, new Set()).get(m.tag)!).add(m.address);
    represented.add(m.address);
    if (m.role === "creator") anyCreator.add(m.address);
  }
  const launchSize = new Map(facts.launchMinters.map((l) => [l.asset, l.minters]));
  const topByTag = new Map<string, CommunityRow["top"]>();
  for (const row of facts.byLaunch) {
    const size = launchSize.get(row.asset) ?? 0;
    if (size === 0) continue;
    const candidate = { asset: row.asset, minters: row.minters, share: row.minters / size };
    const best = topByTag.get(row.tag);
    const eligible = candidate.minters >= TOP_FLOOR;
    const bestEligible = (best?.minters ?? 0) >= TOP_FLOOR;
    // an eligible launch beats an ineligible one; within a class, the larger share wins
    if (!best || (eligible && !bestEligible) || (eligible === bestEligible && candidate.share > best.share)) {
      topByTag.set(row.tag, candidate);
    }
  }
  const paidByTag = new Map(facts.paidByTag.map((r) => [r.tag, r.paid]));
  const tags = new Set([...creators.keys(), ...holders.keys()]);
  const communities = [...tags]
    .map((tag) => {
      const made = creators.get(tag) ?? new Set<string>();
      const held = holders.get(tag) ?? new Set<string>();
      const collectors = [...held].filter((a) => !made.has(a)).length;
      return {
        tag,
        creators: made.size,
        collectors,
        members: made.size + collectors,
        top: topByTag.get(tag) ?? null,
        paid_xcp: paidByTag.get(tag) ?? "0",
      };
    })
    .sort((a, b) => b.members - a.members || a.tag.localeCompare(b.tag));
  return {
    minters: facts.minters,
    represented: represented.size,
    creators: anyCreator.size,
    collectors: represented.size - anyCreator.size,
    paid_xcp: facts.paid,
    communities,
  };
}

/** Store the rollup; rows written only where a value changed, vanished tags pruned. */
export async function writeCommunityRollup(db: D1Database, rollup: CommunityRollup): Promise<number> {
  const rows = rollup.communities.map((c) => ({
    tag: c.tag,
    creators: c.creators,
    collectors: c.collectors,
    members: c.members,
    top_asset: c.top?.asset ?? null,
    top_minters: c.top?.minters ?? null,
    top_share: c.top?.share ?? null,
    paid_xcp: c.paid_xcp,
  }));
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO community_stats (tag, creators, collectors, members, top_asset, top_minters, top_share, paid_xcp)
         SELECT json_extract(value, '$.tag'), json_extract(value, '$.creators'),
                json_extract(value, '$.collectors'), json_extract(value, '$.members'),
                json_extract(value, '$.top_asset'), json_extract(value, '$.top_minters'),
                json_extract(value, '$.top_share'), json_extract(value, '$.paid_xcp')
           FROM json_each(?1)
          WHERE true
         ON CONFLICT (tag) DO UPDATE SET
           creators = excluded.creators, collectors = excluded.collectors, members = excluded.members,
           top_asset = excluded.top_asset, top_minters = excluded.top_minters, top_share = excluded.top_share,
           paid_xcp = excluded.paid_xcp
         WHERE community_stats.creators IS NOT excluded.creators
            OR community_stats.collectors IS NOT excluded.collectors
            OR community_stats.members IS NOT excluded.members
            OR community_stats.top_asset IS NOT excluded.top_asset
            OR community_stats.top_minters IS NOT excluded.top_minters
            OR community_stats.top_share IS NOT excluded.top_share
            OR community_stats.paid_xcp IS NOT excluded.paid_xcp`,
      )
      .bind(JSON.stringify(rows)),
    db
      .prepare(
        `DELETE FROM community_stats
          WHERE tag NOT IN (SELECT json_extract(value, '$.tag') FROM json_each(?1))`,
      )
      .bind(JSON.stringify(rows)),
    db
      .prepare(
        `INSERT INTO community_totals (id, minters, represented, creators, collectors, paid_xcp)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (id) DO UPDATE SET
           minters = excluded.minters, represented = excluded.represented,
           creators = excluded.creators, collectors = excluded.collectors, paid_xcp = excluded.paid_xcp
         WHERE community_totals.minters IS NOT excluded.minters
            OR community_totals.represented IS NOT excluded.represented
            OR community_totals.creators IS NOT excluded.creators
            OR community_totals.collectors IS NOT excluded.collectors
            OR community_totals.paid_xcp IS NOT excluded.paid_xcp`,
      )
      .bind(rollup.minters, rollup.represented, rollup.creators, rollup.collectors, rollup.paid_xcp),
  ]);
  return results.reduce((sum, r) => sum + (r.meta.rows_written ?? 0), 0);
}

/** The stored rollup: 72 rows, two indexed reads. Null until the first refresh has run. */
export async function readCommunityRollup(db: D1Database): Promise<CommunityRollup | null> {
  const [totals, rows] = await Promise.all([
    one<{ minters: number; represented: number; creators: number; collectors: number; paid_xcp: string }>(
      db,
      `SELECT minters, represented, creators, collectors, paid_xcp FROM community_totals WHERE id = 1`,
    ),
    q<{
      tag: string;
      creators: number;
      collectors: number;
      members: number;
      top_asset: string | null;
      top_minters: number | null;
      top_share: number | null;
      paid_xcp: string;
    }>(
      db,
      `SELECT tag, creators, collectors, members, top_asset, top_minters, top_share, paid_xcp
         FROM community_stats
        ORDER BY members DESC, tag`,
    ),
  ]);
  if (!totals) return null;
  return {
    ...totals,
    communities: rows.map((r) => ({
      tag: r.tag,
      creators: r.creators,
      collectors: r.collectors,
      members: r.members,
      top:
        r.top_asset !== null && r.top_minters !== null && r.top_share !== null
          ? { asset: r.top_asset, minters: r.top_minters, share: r.top_share }
          : null,
      paid_xcp: r.paid_xcp,
    })),
  };
}

/** False until a refresh has written every column the current shape carries. */
export async function hasCommunityRollup(db: D1Database): Promise<boolean> {
  const row = await one<{ paid_xcp: string }>(db, `SELECT paid_xcp FROM community_totals WHERE id = 1`);
  return row !== null && row.paid_xcp !== "0";
}
