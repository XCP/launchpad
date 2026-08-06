import { notFound } from "next/navigation";
import {
  fetchBlockHeight,
  fetchFairmints,
  fetchFairmintersByAsset,
  fetchOriginalDeadline,
  fetchPool,
  fetchPoolPriceHistory,
} from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import { isXcp69, launchPhase, windowIsExact } from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";
import { PhasePreview } from "./phase-preview";

export const revalidate = 30;

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
    fairminters.find(isXcp69) ??
    (SHOW_NONCONFORMING
      ? fairminters.find((f) => !f.status.startsWith("invalid"))
      : undefined);
  if (!fm) notFound();

  const [mints, blockHeight, pool, originalDeadline, xcpUsd] = await Promise.all([
    fetchFairmints(fm.tx_hash),
    fetchBlockHeight(),
    fm.status === "closed" ? fetchPool(asset) : Promise.resolve(null),
    // Closed rows can't prove their composed window (rewritten on early
    // fills); the NEW_FAIRMINTER event can.
    fm.status === "closed" && isXcp69(fm)
      ? fetchOriginalDeadline(fm.tx_hash)
      : Promise.resolve(null),
    fetchXcpUsd(),
  ]);
  const conforming =
    isXcp69(fm) && (fm.status !== "closed" || windowIsExact(fm, originalDeadline));
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
    />
  );
}
