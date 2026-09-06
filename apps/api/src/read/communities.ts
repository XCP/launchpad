import { communityFacts } from "#api/queries/communities";
import { J, router } from "#api/read/respond";

export const communitiesRoute = router();

/** A launch needs this many community minters before it can be a community's top launch. */
const TOP_FLOOR = 5;
/** Matched to the refresh cadence: the table changes a few times a day. */
const COMMUNITIES_TTL = 1800;

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
}

/**
 * Which Counterparty communities the site's minters come from. One row per
 * collection: who created there, who collects there, and which launch drew
 * the biggest share of its members. Ranked by share rather than raw count so
 * the largest launch does not top every row.
 */
communitiesRoute.get("/v2/communities", async (c) => {
  const facts = await communityFacts(c.env.DB);
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
  const tags = new Set([...creators.keys(), ...holders.keys()]);
  const communities: CommunityRow[] = [...tags]
    .map((tag) => {
      const made = creators.get(tag) ?? new Set<string>();
      const held = holders.get(tag) ?? new Set<string>();
      const collectors = [...held].filter((a) => !made.has(a)).length;
      return { tag, creators: made.size, collectors, members: made.size + collectors, top: topByTag.get(tag) ?? null };
    })
    .sort((a, b) => b.members - a.members || a.tag.localeCompare(b.tag));
  return J(
    c,
    {
      result: {
        minters: facts.minters,
        represented: represented.size,
        // site-wide, distinct addresses: a creator anywhere counts once, a collector is a member who created nowhere
        creators: anyCreator.size,
        collectors: represented.size - anyCreator.size,
        communities,
      },
    },
    COMMUNITIES_TTL,
  );
});
