import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchBlockHeight,
  fetchFairmints,
  fetchFairmintersByAsset,
  fetchOriginalRecord,
  fetchPool,
  fetchPoolPriceHistory,
} from "@/lib/api/counterparty";
import { fetchLaunchFees } from "@/lib/api/launchpad-api";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { METADATA_ORIGIN, metadataImageUrl } from "@/lib/metadata";
import {
  isXcp69,
  launchPhase,
  windowIsExact,
  xcp69Params,
} from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";
import { PhasePreview } from "./phase-preview";

export const revalidate = 30;

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
  const description = `${asset} on xcp.fun: an XCP-69 launch — 0.01 XCP per 1,000 tokens, sells out or refunds in full, liquidity locked by consensus.`;
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
  const fm =
    // Selection is by parameters only: the timing clauses need the creation
    // event, fetched below. (Also, `find(isXcp69)` would hand the array index
    // in as announceBlock.)
    fairminters.find((f) => xcp69Params(f)) ??
    (SHOW_NONCONFORMING
      ? fairminters.find((f) => !f.status.startsWith("invalid"))
      : undefined);
  if (!fm) notFound();

  const [mints, blockHeight, pool, original, xcpUsd, btcUsd, feeSats] = await Promise.all([
    // A pending fairminter cannot have mints yet; don't ask.
    fm.status === "pending" ? Promise.resolve([]) : fetchFairmints(fm.tx_hash),
    fetchBlockHeight(),
    fm.status === "closed" ? fetchPool(asset) : Promise.resolve(null),
    // The row mutates once a launch leaves "pending" — its block_index
    // becomes the opening block and a closed window becomes the settlement
    // block — so both timing clauses are judged on the creation event.
    fm.status !== "pending" && xcp69Params(fm)
      ? fetchOriginalRecord(fm.tx_hash)
      : Promise.resolve({ deadline: null, announceBlock: null }),
    fetchXcpUsd(),
    // Same upstream feed as fetchXcpUsd (Next dedupes by URL) — only the
    // TX fees stat needs it, and only to convert its sats into a dollar
    // figure when the site-wide denomination toggle is on.
    fetchBtcUsd(),
    // Bitcoin-side fee data only apps/api has; only the minting stat strip
    // reads it, so don't ask outside that phase.
    fm.status === "open" ? fetchLaunchFees(asset) : Promise.resolve(null),
  ]);
  const conforming =
    isXcp69(fm, original.announceBlock) &&
    (fm.status !== "closed" || windowIsExact(fm, original.deadline));
  const phase = launchPhase(fm, pool !== null);
  const priceHistory =
    phase === "graduated" ? await fetchPoolPriceHistory(asset) : [];

  return (
    <PhasePreview
      asset={asset}
      fm={fm}
      conforming={conforming}
      phase={phase}
      blockHeight={blockHeight}
      mints={mints}
      pool={pool}
      priceHistory={priceHistory}
      xcpUsd={xcpUsd}
      btcUsd={btcUsd}
      feeSats={feeSats}
    />
  );
}
