import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  fetchBlockHeight,
  fetchFairmints,
  fetchMempoolFairminter,
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
  fetchLaunchFees,
  type ChartCandle,
} from "@/lib/api/launchpad-api";
import { fetchAssetLaunch, fetchLaunchOriginal } from "@/lib/api/asset-launch";
import { foldPointsToCandles, type ChartResolution } from "@/lib/candles";
import { proseDescription } from "@launchpad/xcp69/description";
import { fetchMarketPrices } from "@/lib/api/price";
import { METADATA_ORIGIN, metadataImageUrl } from "@/lib/metadata";
import { isLocale, localePath } from "@/lib/i18n/locales";
import { localeAlternates, openGraphLocale } from "@/lib/i18n/seo";
import {
  circulatingSupplyRaw,
  isXcp69,
  launchPhase,
  windowIsExact,
} from "@/lib/xcp69";
import { LaunchView } from "@/app/[lang]/[asset]/_components/launch-view";

export const revalidate = 30;

/**
 * The indexed launch and any fallback, resolved once per render.
 *
 * generateMetadata needs it for the unfurled description and the page body
 * needs it for burned supply and the rest, and Next's fetch memoization does
 * not see either call: in production the API module goes over a service
 * binding, not global fetch, so both callers were paying for the same row.
 * React's cache() shares the promise for the lifetime of one server request
 * only. Missing rows and failures are forgotten with the request, so this
 * adds no persistent cache and a later render can see a recovered index.
 *
 * Kept in this server-only module rather than the API module, which Client
 * Components import too.
 */
const assetLaunch = cache((asset: string) => fetchAssetLaunch(asset, { freshStatus: true }));

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
    const launch = await assetLaunch(asset);
    const { indexed } = launch;
    if (indexed?.displayDescription) {
      return clamp(indexed.displayDescription, SHARE_DESCRIPTION_MAX);
    }
    const fm =
      launch.fm ??
      (!launch.hasConfirmedFairminters ? await fetchMempoolFairminter(asset) : null);
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
  params: Promise<{ asset: string; lang: string }>;
}): Promise<Metadata> {
  const { asset: raw, lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const asset = decodeURIComponent(raw).toUpperCase();
  if (!/^[B-Z][A-Z]{3,11}$/.test(asset)) return {};
  const title = `${asset} — xcp.fun`;
  const description = (await shareDescription(asset)) ?? `${asset} on xcp.fun`;
  const image = metadataImageUrl(asset);
  return {
    title,
    description,
    alternates: localeAlternates(locale, `/${asset}`),
    openGraph: {
      title,
      description,
      ...openGraphLocale(locale),
      url: `${METADATA_ORIGIN}${localePath(locale, `/${asset}`)}`,
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

  const launch = await assetLaunch(asset);
  const { indexed } = launch;
  let fm = launch.fm;

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
    const pending = !launch.hasConfirmedFairminters ? await fetchMempoolFairminter(asset) : null;
    if (!pending) notFound();
    fm = {
      ...pending,
      status: pending.start_block > blockHeight ? "pending" : "open",
      confirmed: false,
    };
    isPendingConfirmation = true;
  }

  const [mints, pool, original, prices, feeSats] = await Promise.all([
    // A pending fairminter cannot have mints yet; don't ask. Same for
    // anything still unconfirmed — the tx_hash isn't indexed yet either.
    fm.status === "pending" || isPendingConfirmation
      ? Promise.resolve([])
      : fetchFairmints(fm.tx_hash),
    fm.status === "closed" ? fetchPool(asset) : Promise.resolve(null),
    // The indexed immutable creation evidence avoids another protocol read.
    // Missing evidence still falls back to the original event, never the
    // mutable opening or settlement block on the fairminter row.
    fetchLaunchOriginal({ ...launch, fm }),
    // Both currencies come from the same parsed ticker. Independent readers
    // carry AbortSignals, so Next does not deduplicate their fetches.
    fetchMarketPrices(),
    // Bitcoin-side fee data only apps/api has; only the minting stat strip
    // reads it, so don't ask outside that phase.
    fm.status === "open" && !isPendingConfirmation
      ? fetchLaunchFees(asset)
      : Promise.resolve(null),
  ]);
  const { xcp: xcpUsd, btc: btcUsd } = prices;
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
