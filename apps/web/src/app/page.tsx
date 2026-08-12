import Link from "next/link";
import { HomeToolbar } from "@/app/_components/home-toolbar";
import { LaunchSections, type SectionRow } from "@/app/_components/launch-sections";
import type { SearchRow } from "@/app/_components/launch-search";
import { fetchIndexedLaunches, fetchLaunchStats } from "@/lib/api/launchpad-api";
import {
  fetchAllFairminters,
  fetchBlockHeight,
  fetchOriginalRecord,
  fetchPool,
} from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import {
  fromSats,
} from "@/lib/format";
import { big, ratio } from "@/lib/numeric";
import {
  isXcp69,
  launchPhase,
  saleProgress,
  windowIsExact,
  xcp69Params,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";

export const revalidate = 60;

/**
 * Rows fetched per phase — and the window every section pages through.
 *
 * One number rather than three, chosen so each section's page size divides it
 * exactly: graduated pages by 8 (three pages), minting by 24 (one), scheduled
 * by 12 (two). Nothing is fetched that no page can reach, and no section ends
 * on a stub page.
 *
 * It is deliberately a window and not the whole table. The front page shows a
 * ranked slice, says so in each heading ("8 of 47"), and search reaches the
 * rest — so this bounds the payload and the D1 read no matter how many
 * launches exist. Keep it a common multiple of the page sizes in
 * launch-sections.tsx if either changes.
 */
const SECTION_WINDOW = 24;

export default async function HomePage() {
  const [blockHeight, xcpUsd, stats] = await Promise.all([
    fetchBlockHeight(),
    fetchXcpUsd(),
    fetchLaunchStats(),
  ]);

  // launchpad-api mirrors exactly this query — a launches table read instead
  // of a fan-out over every fairminter on the chain. A miss or a timeout
  // falls through to the same derivation this page always did, so the site
  // works with the API down, empty, or simply not caught up yet.
  const indexed = await fetchIndexedLaunches(SECTION_WINDOW);

  const phased =
    indexed ??
    (await (async () => {
      const fairminters = await fetchAllFairminters();

      // Parameters only here — the timing clauses need each launch's
      // creation event, which is fetched below for exactly these rows.
      // Filtering on the full predicate would reject every launch that has
      // already opened, since its row no longer reports the block it was
      // announced in.
      const listed = fairminters.filter((fm) => xcp69Params(fm));

      // Newest first; the pool row is the graduated-vs-refunded oracle, only
      // worth a lookup for closed pool fairminters.
      listed.sort((a, b) => b.block_index - a.block_index);
      return (
        await Promise.all(
          listed.map(async (fm) => {
            const closed = fm.status === "closed";
            const [pool, original] = await Promise.all([
              closed && big(fm.pool_quantity) > 0n
                ? fetchPool(fm.asset)
                : Promise.resolve(null),
              // A row past "pending" has had its block_index rewritten to
              // the opening block, so creation facts come from the event —
              // but only for rows whose parameters could conform at all.
              // Every launch on the chain is listed here; asking about all
              // of them is hundreds of subrequests for an answer six of
              // them can use.
              fm.status !== "pending" && xcp69Params(fm)
                ? fetchOriginalRecord(fm.tx_hash)
                : { deadline: null, announceBlock: null },
            ]);
            const conforming =
              isXcp69(fm, original.announceBlock) &&
              (!closed || windowIsExact(fm, original.deadline));
            // Same fixed supply everywhere, so XCP depth IS the value
            // ranking: exact sort key, near-equal pools must not swap
            // places between renders.
            const xcpDepth = big(
              pool ? (pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b) : 0,
            );
            return {
              fm,
              phase: launchPhase(fm, pool !== null),
              conforming,
              xcpDepth,
              poolXcpReserve: pool
                ? String(pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b)
                : null,
              poolTokenReserve: pool
                ? String(pool.asset_a === fm.asset ? pool.reserve_a : pool.reserve_b)
                : null,
              announceBlock: original.announceBlock,
              // Only apps/api counts distinct minters; the live path is the
              // fallback and reports none rather than guessing.
              minters: 0,
            };
          }),
        )
      ).filter((p) => p.conforming);
    })());

  // Rows carry the derived numbers so the client never re-derives them and
  // the ordering can never disagree with what a card prints.
  const rows: SectionRow[] = phased
    .filter((p) => p.fm.asset)
    .map((p) => {
      const xcpReserve = big(p.poolXcpReserve ?? 0);
      const tokenReserve = big(p.poolTokenReserve ?? 0);
      // Price is the pool's own ratio; supply is fixed by the standard, so
      // market cap is that price across the whole hard cap.
      const priceXcp = tokenReserve > 0n ? ratio(xcpReserve, tokenReserve) : 0;
      return {
        fm: p.fm,
        phase: p.phase,
        conforming: p.conforming,
        priceXcp,
        marketCapXcp: priceXcp * fromSats(p.fm.hard_cap),
        minters: p.minters ?? 0,
        announceBlock: p.announceBlock ?? 0,
        progress: saleProgress(p.fm),
      };
    });

  const searchRows: SearchRow[] = rows.map((r) => ({
    asset: r.fm.asset,
    // Only when it says something the asset name doesn't.
    name:
      r.fm.asset_longname && r.fm.asset_longname !== r.fm.asset
        ? r.fm.asset_longname
        : null,
    phase: r.phase as SearchRow["phase"],
    source: r.fm.source,
    announceBlock: r.announceBlock,
    minters: r.minters,
    marketCapXcp: r.marketCapXcp,
    progress: r.progress,
    startBlock: r.fm.start_block,
  }));

  return (
    <div className="space-y-10">
      <HomeToolbar rows={searchRows} height={blockHeight} xcpUsd={xcpUsd} />

      {rows.length === 0 && <FirstLaunchHero />}

      <LaunchSections
        rows={rows}
        totals={
          stats ? {
            graduated: stats.counts.graduated,
            minting: stats.counts.minting,
            scheduled: stats.counts.scheduled,
          } : undefined
        }
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






