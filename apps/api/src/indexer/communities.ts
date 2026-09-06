/**
 * address_communities: which curated collections the site's minters created
 * in or hold, asked of the explorer in batches of fifty. The minter set only
 * grows and a collection's membership drifts slowly, so a refresh a few times
 * a day is plenty; a batch the explorer fails is left as it was and retried
 * sooner rather than pruned on a partial answer.
 */
import { ADDRESS_BATCH, fetchAddressCollections } from "#api/integrations/explorer";
import {
  communitiesSyncedAt,
  listMinterAddresses,
  markCommunitiesSynced,
  pruneCommunities,
  upsertCommunities,
  type CommunityMembership,
} from "#api/queries/communities";

const REFRESH_SECONDS = 6 * 3600;
const RETRY_SECONDS = 30 * 60;

export async function syncCommunities(db: D1Database): Promise<
  { skipped: true } | { minters: number; batches: number; failed: number; written: number; removed: number }
> {
  const now = Math.floor(Date.now() / 1000);
  const last = await communitiesSyncedAt(db);
  if (last !== null && now - last < REFRESH_SECONDS) return { skipped: true };

  const minters = await listMinterAddresses(db);
  let written = 0;
  let removed = 0;
  let failed = 0;
  let batches = 0;
  for (let i = 0; i < minters.length; i += ADDRESS_BATCH) {
    const batch = minters.slice(i, i + ADDRESS_BATCH);
    batches++;
    let fresh: CommunityMembership[];
    try {
      fresh = (await fetchAddressCollections(batch)).flatMap((row) => [
        ...row.collections.map((c) => ({ address: row.address, tag: c.tag, role: "creator" as const, cards: c.cards })),
        ...(row.held ?? []).map((c) => ({ address: row.address, tag: c.tag, role: "holder" as const, cards: c.cards })),
      ]);
    } catch {
      failed++;
      continue;
    }
    written += await upsertCommunities(db, fresh);
    removed += await pruneCommunities(db, batch, fresh);
  }
  // A partial run is recorded as older than it is, so the next tick past the
  // retry window tries again instead of waiting the full interval.
  await markCommunitiesSynced(db, failed > 0 ? now - REFRESH_SECONDS + RETRY_SECONDS : now);
  return { minters: minters.length, batches, failed, written, removed };
}
