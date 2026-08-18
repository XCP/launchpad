import Link from "next/link";
import { HomeToolbar } from "@/app/_components/home-toolbar";
import { type InitialPages, LaunchSections } from "@/app/_components/launch-sections";
import { type LaunchPage, PER_PAGE, toSectionRow } from "@/lib/launch-row";
import { fetchLaunchPage } from "@/lib/api/launchpad-api";
import {
  fetchAllFairminters,
  fetchBlockHeight,
  fetchMinterCount,
  fetchOriginalRecord,
  fetchPool,
} from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import { big } from "@/lib/numeric";
import {
  isXcp69,
  type LaunchPhase,
  launchPhase,
  windowIsExact,
  xcp69Params,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";

export const revalidate = 60;

/**
 * The three sections, each fetched as page one of its own phase.
 *
 * There is no window any more, and that is the point. This page used to ask
 * for a fixed number of rows per phase and hand the whole lot to the browser
 * to sort, slice and page in memory — which meant the sections were not
 * paging a list, they were paging a prefetch. Anything ranked past the cut
 * was not merely on a later page, it was absent: the sort menus reorder what
 * the browser holds, so a launch outside the window could not be reached by
 * any control on the page. With minting ranked by progress toward the soft
 * cap, the rows that fell outside were precisely the ones that had never been
 * minted — the launches most in need of being seen.
 *
 * Now each section asks for `PER_PAGE[phase]` rows at an offset and gets the
 * phase's true length back with them, so the heading, the rows and the pager
 * are three readings of one answer instead of three different sources. It
 * also drops a request: the counts used to come from /v2/stats, which counted
 * the table while the pager divided the prefetch — the two numbers that
 * disagreed.
 */
const SECTIONS = ["graduated", "minting", "scheduled"] as const;

export default async function HomePage() {
  const [blockHeight, xcpUsd, ...first] = await Promise.all([
    fetchBlockHeight(),
    fetchXcpUsd(),
    // No `sort`: the API's own default for each phase, so the ordering has one
    // definition rather than a copy here that could drift from it.
    ...SECTIONS.map((phase) => fetchLaunchPage(phase, undefined, PER_PAGE[phase], 0)),
  ]);

  // All three or none. A partial answer would render one section paged and
  // another from a live derivation, which is two different orderings of the
  // same site on one screen.
  const indexed = first.every((p) => p !== null)
    ? (first as NonNullable<(typeof first)[number]>[])
    : null;

  /**
   * The live derivation, unchanged, for when the API cannot answer.
   *
   * It returns EVERY conforming launch rather than a page, because it has to:
   * there is no query to ask for page two of a fan-out over the whole chain.
   * That is what `paged={false}` tells the sections — sort and slice this
   * yourselves, and don't ask for more.
   */
  const deriveLive = async () => {
    const fairminters = await fetchAllFairminters();

    // Parameters only here — the timing clauses need each launch's creation
    // event, which is fetched below for exactly these rows. Filtering on the
    // full predicate would reject every launch that has already opened, since
    // its row no longer reports the block it was announced in.
    const listed = fairminters.filter((fm) => xcp69Params(fm));

    // Newest first; the pool row is the graduated-vs-refunded oracle, only
    // worth a lookup for closed pool fairminters.
    listed.sort((a, b) => b.block_index - a.block_index);
    return (
      await Promise.all(
        listed.map(async (fm) => {
          const closed = fm.status === "closed";
          const [pool, original, minters] = await Promise.all([
            closed && big(fm.pool_quantity) > 0n
              ? fetchPool(fm.asset)
              : Promise.resolve(null),
            // A row past "pending" has had its block_index rewritten to the
            // opening block, so creation facts come from the event — but only
            // for rows whose parameters could conform at all. Every launch on
            // the chain is listed here; asking about all of them is hundreds
            // of subrequests for an answer six of them can use.
            fm.status !== "pending" && xcp69Params(fm)
              ? fetchOriginalRecord(fm.tx_hash)
              : { deadline: null, announceBlock: null },
            // Distinct minters, which this path used to report as a flat 0 —
            // and 0 is a CLAIM, not a blank. Every card on the page said "0 of
            // 69 minters" beside its own progress bar reading 43%, so the
            // homepage contradicted itself on every card whenever the API
            // blinked, which is worse than the outage it was covering for.
            //
            // Nobody has minted on a launch that has earned nothing, so that
            // case is 0 by inspection rather than by request. The rest cost
            // one read each, issued alongside the creation-event fetch these
            // same rows already make rather than after it — no extra round
            // trip, and only on the path that runs when the API is down.
            big(fm.earned_quantity ?? 0) > 0n
              ? fetchMinterCount(fm.tx_hash)
              : 0,
          ]);
          const conforming =
            isXcp69(fm, original.announceBlock) &&
            (!closed || windowIsExact(fm, original.deadline));
          return {
            fm,
            phase: launchPhase(fm, pool !== null),
            conforming,
            poolXcpReserve: pool
              ? String(pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b)
              : null,
            poolTokenReserve: pool
              ? String(pool.asset_a === fm.asset ? pool.reserve_a : pool.reserve_b)
              : null,
            announceBlock: original.announceBlock,
            // Null when the count could not be read at all — the card prints
            // that as an em dash instead of inventing a number for it.
            minters,
          };
        }),
      )
    ).filter((p) => p.conforming);
  };

  let initial: InitialPages;
  let paged: boolean;
  let count: number;

  if (indexed) {
    const [graduated, minting, scheduled] = indexed.map<LaunchPage>((p) => ({
      rows: p.rows.map(toSectionRow),
      total: p.total,
    })) as [LaunchPage, LaunchPage, LaunchPage];
    initial = { graduated, minting, scheduled };
    paged = true;
    count = graduated.total + minting.total + scheduled.total;
  } else {
    // Rows carry the derived numbers so the client never re-derives them and
    // the ordering can never disagree with what a card prints.
    const rows = (await deriveLive())
      .filter((p) => p.fm.asset)
      .map(toSectionRow);
    const of = (phase: LaunchPhase): LaunchPage => {
      const held = rows.filter((r) => r.phase === phase);
      // `total` is the length of what we hold, because here that IS the whole
      // phase. In the paged case it is the database's count and can exceed
      // the page — the two agree on what the number means, not on where it
      // comes from.
      return { rows: held, total: held.length };
    };
    initial = { graduated: of("graduated"), minting: of("minting"), scheduled: of("scheduled") };
    paged = false;
    count = rows.length;
  }

  return (
    <div className="space-y-10">
      {/* Search fetches its own index when it first opens — it has to see
          every conforming launch, and this page only holds three pages. */}
      <HomeToolbar height={blockHeight} xcpUsd={xcpUsd} />

      {count === 0 && <FirstLaunchHero />}

      <LaunchSections
        initial={initial}
        paged={paged}
        height={blockHeight}
        xcpUsd={xcpUsd}
      />
    </div>
  );
}

function FirstLaunchHero() {
  return (
    <div className="holo-border rounded-xl p-8 text-center">
      <h1 className="text-2xl font-bold">Fairmint pools are live.</h1>
      <p className="mx-auto mt-3 max-w-xl text-gray-600">
        The first XCP-69 launch in history hasn&apos;t happened yet. All-or-nothing
        mints, at least {XCP69_MIN_PARTICIPANTS} participants required, every
        raised XCP locked into the pool forever — enforced by consensus, not by
        this website.
      </p>
      <Link
        href="/create"
        className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
      >
        Launch the first
      </Link>
    </div>
  );
}






