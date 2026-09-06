import { readCommunityRollup } from "#api/queries/communities";
import { J, router } from "#api/read/respond";

export const communitiesRoute = router();

/** Matched to the refresh cadence: the tables change a few times a day. */
const COMMUNITIES_TTL = 1800;

/**
 * Which Counterparty communities the site's minters come from, from the
 * rollup the indexer materialises (see src/indexer/communities.ts). A read
 * is two indexed queries over ~72 rows; the aggregation happens at refresh
 * time, not per request.
 */
communitiesRoute.get("/v2/communities", async (c) => {
  const rollup = await readCommunityRollup(c.env.DB);
  return J(
    c,
    { result: rollup ?? { minters: 0, represented: 0, creators: 0, collectors: 0, paid_xcp: "0", communities: [] } },
    rollup ? COMMUNITIES_TTL : 60,
  );
});
