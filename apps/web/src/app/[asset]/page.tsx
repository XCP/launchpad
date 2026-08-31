import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchBlockHeight,
  fetchFairmints,
  fetchFairmintersByAsset,
  fetchMempoolFairminter,
  fetchOriginalRecord,
  fetchPool,
  fetchPriceSeries,
  fetchHolderCount,
  fetchHolderConcentration,
  fetchPairActivity,
  type PairActivity,
  type PoolVolume,
} from "@/lib/api/counterparty";
import {
  fetchCandles,
  fetchEventsBySource,
  fetchIndexedLaunch,
  fetchLaunchFees,
  type ChartCandle,
} from "@/lib/api/launchpad-api";
import { foldPointsToCandles, type ChartResolution } from "@/lib/candles";
import { proseDescription } from "@launchpad/xcp69/description";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { METADATA_ORIGIN, metadataImageUrl } from "@/lib/metadata";
import {
  circulatingSupplyRaw,
  isXcp69,
  launchPhase,
  windowIsExact,
  xcp69Params,
} from "@/lib/xcp69";
import { LaunchView } from "@/app/[asset]/_components/launch-view";

export const revalidate = 30;

/** Long enough to say something, short enough that no platform truncates
 *  it mid-word. */
const SHARE_DESCRIPTION_MAX = 200;

/**
 * The unfurled description: the creator's own words, or failing that the
 * address behind the launch.
 *
 * NOT the standard's terms. Those are identical on every XCP-69 launch, so a
 * timeline of shared links all said exactly the same thing — the one place
 * the description has to distinguish this launch from the next one is the
 * one place it didn't. The terms are on the page itself for anyone who
 * follows the link.
 */
async function shareDescription(asset: string): Promise<string | null> {
  try {
    const indexed = await fetchIndexedLaunch(asset);
    if (indexed?.displayDescription) {
      return clamp(indexed.displayDescription, SHARE_DESCRIPTION_MAX);
    }
    const fairminters = await fetchFairmintersByAsset(asset);
    const fm =
      fairminters.find((f) => xcp69Params(f)) ??
      (await fetchMempoolFairminter(asset));
    if (!fm) return null;

    const onChain = typeof fm.description === "string" ? fm.description.trim() : "";

    // Our own hosted JSON holds the words; the on-chain field is just the
    // pointer. Only ever OUR origin — the description is chosen by the
    // issuer, so following it anywhere else would have our server fetch a
    // URL a stranger controls. Same rule the browser-side reader applies
    // (isOurMetadata), inlined so this server path doesn't pull in a client
    // module for one string comparison.
    if (onChain.startsWith(`${METADATA_ORIGIN}/`)) {
      const meta = (await fetch(onChain, { next: { revalidate: 300 } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as { description?: unknown } | null;
      const words = typeof meta?.description === "string" ? meta.description.trim() : "";
      if (words) return clamp(words, SHARE_DESCRIPTION_MAX);
    } else {
      // A launch composed elsewhere can put real text on-chain — or its
      // content, which is not text at all. An inscribed launch's description
      // is an image, an SVG, or a whole HTML page; unfurling
      // `<!doctype html><html lang="en">…` as the creator's pitch is worse
      // than falling through to the issuer line below.
      const words = proseDescription(onChain, fm.mime_type, asset);
      if (words) return clamp(words, SHARE_DESCRIPTION_MAX);
    }

    return fm.source ? `Launched by ${fm.source}` : null;
  } catch {
    return null;
  }
}

/** Cut on a word boundary; an ellipsis mid-word reads as a bug. */
function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Link previews carry the launch's own art. The image URL is our permanent
 * /full/<ASSET> alias, so a card that unfurls today still resolves years
 * from now — the same guarantee the on-chain description depends on.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ asset: string }>;
}): Promise<Metadata> {
  const { asset: raw } = await params;
  const asset = decodeURIComponent(raw).toUpperCase();
  if (!/^[B-Z][A-Z]{3,11}$/.test(asset)) return {};
  const title = `${asset} — xcp.fun`;
  const description = (await shareDescription(asset)) ?? `${asset} on xcp.fun`;
  const image = metadataImageUrl(asset);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${METADATA_ORIGIN}/${asset}`,
      images: [{ url: image, width: 1024, height: 1024, alt: `${asset} artwork` }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function LaunchPage({
  params,
}: {
  params: Promise<{ asset: string }>;
}) {
  const { asset: rawAsset } = await params;
  const asset = decodeURIComponent(rawAsset).toUpperCase();

  // Root-level slug catches every unknown path (favicon.ico, crawlers, …);
  // only named-asset shapes are worth an API round-trip. Lowercase works —
  // /pepe uppercases — while real routes stay lowercase and take precedence.
  if (!/^[B-Z][A-Z]{3,11}$/.test(asset)) notFound();

  const fairminters = await fetchFairmintersByAsset(asset);
  let fm =
    // Selection is by parameters only: the timing clauses need the creation
    // event, fetched below. (Also, `find(isXcp69)` would hand the array index
    // in as announceBlock.)
    fairminters.find((f) => xcp69Params(f));

  // blockHeight is needed up front now: a mempool-sourced fm needs it to
  // compute a real status (mempool-time status is computed against
  // counterparty-core's own sentinel height, so it always reads "open"
  // even for a launch whose start_block is still days out).
  const blockHeight = await fetchBlockHeight();
  let isPendingConfirmation = false;

  if (!fm) {
    // Nothing confirmed yet doesn't mean nothing exists — a launch page
    // visited right after its own creation is broadcast, not confirmed.
    // /assets/{asset}/fairminters only ever returns confirmed rows, so
    // check the mempool before giving up. Shaped as an ordinary Fairminter
    // so it flows through the same Scheduled/Minting view as everything
    // else — no separate "pending" page to keep in sync.
    const pending = fairminters.length === 0 ? await fetchMempoolFairminter(asset) : null;
    if (!pending) notFound();
    fm = {
      ...pending,
      status: pending.start_block > blockHeight ? "pending" : "open",
      confirmed: false,
    };
    isPendingConfirmation = true;
  }

  const [mints, pool, original, xcpUsd, btcUsd, feeSats, indexed] = await Promise.all([
    // A pending fairminter cannot have mints yet; don't ask. Same for
    // anything still unconfirmed — the tx_hash isn't indexed yet either.
    fm.status === "pending" || isPendingConfirmation
      ? Promise.resolve([])
      : fetchFairmints(fm.tx_hash),
    fm.status === "closed" ? fetchPool(asset) : Promise.resolve(null),
    // The row mutates once a launch leaves "pending" — its block_index
    // becomes the opening block and a closed window becomes the settlement
    // block — so both timing clauses are judged on the creation event.
    // An unconfirmed launch skips this too: isXcp69's own confirmed-false
    // path already treats the pre-announcement clause as satisfied.
    fm.status !== "pending" && !isPendingConfirmation && xcp69Params(fm)
      ? fetchOriginalRecord(fm.tx_hash)
      : Promise.resolve({ deadline: null, announceBlock: null }),
    fetchXcpUsd(),
    // Same upstream feed as fetchXcpUsd (Next dedupes by URL) — only the
    // TX fees stat needs it, and only to convert its sats into a dollar
    // figure when the site-wide denomination toggle is on.
    fetchBtcUsd(),
    // Bitcoin-side fee data only apps/api has; only the minting stat strip
    // reads it, so don't ask outside that phase.
    fm.status === "open" && !isPendingConfirmation
      ? fetchLaunchFees(asset)
      : Promise.resolve(null),
    fetchIndexedLaunch(asset),
  ]);
  const burnedQuantity = indexed?.burnedQuantity ?? "0";
  const circulatingRaw = circulatingSupplyRaw(fm.hard_cap, burnedQuantity);
  // The creator's own trades on this asset, for the chart's markers. Indexed
  // by address, so this is one read — and only worth asking once a market
  // exists to trade in.
  // Distribution facts. Only meaningful once a market exists, and the holder
  // list is the same one the Holders tab reads.
  const concentration = pool
    ? await fetchHolderConcentration(asset, fm.source, String(circulatingRaw))
    : { top10Pct: 0, devPct: 0 };

  const devTrades =
    pool !== null
      ? ((await fetchEventsBySource(fm.source)) ?? [])
          .filter((e) => e.asset === asset)
          .map((e) => ({ block: e.block, kind: e.kind === "sell" ? ("sell" as const) : ("buy" as const) }))
      : [];

  const conforming =
    isXcp69(fm, original.announceBlock) &&
    (fm.status !== "closed" || windowIsExact(fm, original.deadline));
  const phase = launchPhase(fm, pool !== null);
  const emptyWindow: PoolVolume = {
    volumeXcpRaw: "0",
    trades: 0,
    buys: 0,
    sells: 0,
    buyVolXcpRaw: "0",
    sellVolXcpRaw: "0",
    buyers: 0,
    sellers: 0,
  };
  const emptyActivity: PairActivity = {
    "24h": emptyWindow,
    "30d": emptyWindow,
    all: emptyWindow,
  };
  // Candles come from apps/api's folded table — one indexed range read
  // instead of re-paginating both Counterparty match feeds on every view.
  // Both resolutions, so the chart's range selector needs no round trip.
  const [tableHourly, tableDaily, holderCount, poolVolume] =
    phase === "graduated"
      ? await Promise.all([
          fetchCandles(asset, "1h"),
          fetchCandles(asset, "1d"),
          fetchHolderCount(asset),
          pool ? fetchPairActivity(asset) : Promise.resolve(emptyActivity),
        ])
      : [null, null, null, emptyActivity];

  // The table is a cache with provenance, not a new source of truth. It is
  // empty for the window between a launch graduating and the indexer's next
  // tick folding it — exactly when a new market is most worth looking at — so
  // the live fills still answer when it has nothing.
  let candles: Record<ChartResolution, ChartCandle[]> = {
    "1h": tableHourly ?? [],
    "1d": tableDaily ?? [],
  };
  if (phase === "graduated" && (!tableHourly || !tableDaily)) {
    const fills = await fetchPriceSeries(asset);
    candles = {
      "1h": tableHourly ?? foldPointsToCandles(asset, fills, "1h"),
      "1d": tableDaily ?? foldPointsToCandles(asset, fills, "1d"),
    };
  }

  return (
    <LaunchView
      asset={asset}
      fm={fm}
      conforming={conforming}
      phase={phase}
      blockHeight={blockHeight}
      mints={mints}
      pool={pool}
      candles={candles}
      xcpUsd={xcpUsd}
      launchXcpUsd={indexed?.launchXcpUsd ?? null}
      btcUsd={btcUsd}
      feeSats={feeSats}
      devTrades={devTrades}
      concentration={concentration}
      holderCount={holderCount}
      poolVolume={poolVolume}
      displayDescription={indexed?.displayDescription ?? null}
      burnedQuantity={burnedQuantity}
    />
  );
}
