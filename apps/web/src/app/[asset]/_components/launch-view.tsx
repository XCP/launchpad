"use client";

import Link from "next/link";
import { AnnouncedAgo, ArtLightbox, BlockAgo, BlockMonthYear, ShareButton, StatusPill } from "@/app/[asset]/_components/launch-chrome";
import { HostedDescription, HostedSocials, InscriptionChip, LaunchDescription, isOurMetadata } from "@/app/[asset]/_components/launch-metadata";
import { DenomToggle, ParticipantsStat, RaisedStat, TermsStrip, TxFeesStat } from "@/app/[asset]/_components/launch-stats";
import { ScheduledPulse } from "@/app/[asset]/_components/scheduled-pulse";
import { AddressHoverCard, IssuerChips, IssuerLine } from "@/components/address-hover-card";
import type { Fairmint, PairActivity, Pool } from "@/lib/api/counterparty";
import type { ChartCandle, FeeSummary } from "@/lib/api/launchpad-api";
import type { ChartResolution } from "@/lib/candles";
import { LABEL } from "@/components/ui/tokens";
import { LaunchRoomProvider } from "@/app/[asset]/_components/launch-room";
import {
  blocksEta,
  commas,
  commasRaw,
  compact,
  fromSats,
  price as formatPrice,
  shortAddress,
  tokenQty,
  usd,
} from "@/lib/format";
import { big, rawEquals } from "@/lib/numeric";
import { priceChangePercent } from "@/lib/market";
import {
  type Fairminter,
  XCP69_EXACT,
  type LaunchPhase,
  saleProgress,
  saleTarget,
} from "@/lib/xcp69";
import { ActivityTabs } from "@/app/[asset]/_components/activity-tabs";
import { AssetTradeSurface } from "@/app/[asset]/_components/asset-trade-surface";
import { EditPanel } from "@/app/[asset]/_components/edit-panel";
import { LiveProgress } from "@/app/[asset]/_components/live-progress";
import { MintPanel } from "@/app/[asset]/_components/mint-panel";
import { PressurePanel } from "@/app/[asset]/_components/pressure-panel";
import { PriceChart, type DevTrade } from "@/app/[asset]/_components/price-chart";

/**
 * The launch page's entire presentation, data in via props. No fetching
 * happens here.
 *
 * Shape: a terminal for one asset. Header answers "how's it doing?" at a
 * glance (price, multiple, change), a dense stat strip carries the numbers,
 * the aside answers "do I want in or out?" with the forms, and the prose
 * collapses into chips and tooltips.
 */
export function LaunchView({
  asset,
  fm,
  conforming,
  phase,
  blockHeight,
  mints,
  pool,
  candles,
  xcpUsd,
  btcUsd,
  feeSats,
  holderCount,
  poolVolume,
  devTrades = [],
  concentration,
  displayDescription,
}: {
  asset: string;
  fm: Fairminter;
  conforming: boolean;
  phase: LaunchPhase;
  blockHeight: number;
  mints: Fairmint[];
  pool: Pool | null;
  candles: Record<ChartResolution, ChartCandle[]>;
  xcpUsd: number | null;
  btcUsd: number | null;
  feeSats: FeeSummary | null;
  holderCount: number | null;
  poolVolume: PairActivity;
  devTrades?: DevTrade[];
  concentration?: { top10Pct: number; devPct: number };
  displayDescription: string | null;
}) {
  const progress = saleProgress(fm);
  // An inscribed launch's description IS the image (hex-encoded on the
  // wire) rather than our hosted JSON URL — mime_type is the only signal
  // that distinguishes the two, since a raw hex blob isn't a URL either.
  const isInscribed = fm.mime_type?.startsWith("image/") ?? false;
  // sort_pair orders the pool lexically — XCP can sit on either side.
  const xcpIsA = pool?.asset_a === "XCP";
  // Raw reserves, not `_normalized`: the normalized strings are API-side
  // float artifacts; the raw integer is authoritative.
  const poolXcpRaw = pool ? (xcpIsA ? pool.reserve_a : pool.reserve_b) : 0;
  const poolTokensRaw = pool ? (xcpIsA ? pool.reserve_b : pool.reserve_a) : 0;
  // Doubles below: ratios, percentages, USD estimates (reserves ~3e15 raw).
  const poolXcp = fromSats(poolXcpRaw);
  const poolTokens = fromSats(poolTokensRaw);

  // Per-address totals summed exactly; the concentration stat reads them.
  const byAddress = new Map<string, bigint>();
  for (const m of mints) {
    byAddress.set(m.source, (byAddress.get(m.source) ?? 0n) + big(m.earn_quantity));
  }
  const participants = byAddress.size;
  // Biggest minters first — the addresses worth checking for freshness.
  const minterAddresses = [...byAddress.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([source]) => source);

  // "How's it doing" numbers (graduated): spot from the pool and change from
  // what this launch actually charged minters. The first candle is the first
  // completed trade, already above or below the pool's opening state, so using
  // it as an unlabeled baseline understates the launch return.
  const spot = poolTokens > 0 ? poolXcp / poolTokens : 0;
  const history = candles["1d"];
  const quantityByPrice = fromSats(fm.quantity_by_price);
  const mintPrice = quantityByPrice > 0 ? fromSats(fm.price) / quantityByPrice : 0;
  const change = priceChangePercent(spot, mintPrice);
  // The highest price the pool ever printed, and where spot sits against it.
  // Free — the same history the chart already renders.
  // The high wick, not the close: a peak a candle traded at and gave back is
  // still a peak the token reached.
  const athPrice = history.reduce((max, c) => (c.high > max ? c.high : max), 0);
  const athPct = athPrice > 0 && spot > 0 ? Math.min(100, (spot / athPrice) * 100) : 0;

  const supplyTokens = fromSats(fm.hard_cap);
  const mcapUsd = xcpUsd && spot > 0 ? spot * supplyTokens * xcpUsd : null;

  // Minting now renders as a poster (above); the terminal layout is for
  // launches with a market to look at.

  // Only "graduated" (pool or not) ever reaches this point — scheduled,
  // minting, and refunded all return their own views earlier.

  /* The stat strip: dense, phase-specific, no prose. */
  const strip: [string, string][] = pool
    ? [
        ["24h volume", `${commas(fromSats(poolVolume["24h"].volumeXcpRaw))} XCP`],
        [
          // No "LP burned" here: the launch's own LP was burned, but anyone can
          // add liquidity on top afterwards, so the claim doesn't hold for the
          // live total. It belongs on the locked pool row in Holders, which is
          // about the burned position specifically.
          "Liquidity",
          `${commas(Math.round(poolXcp))} XCP${xcpUsd ? ` (${usd(poolXcp * xcpUsd)})` : ""}`,
        ],
        ["In pool", `${compact(poolTokens)} ${asset}`],
        [
          "Holders",
          `${commas(holderCount ?? participants)}${
            participants ? ` · ${commas(participants)} minted` : ""
          }`,
        ],
        // Two numbers that say whether the supply is spread or held. A creator
        // at 0% is the strongest thing this page can state about them, and it
        // sits next to the B/S markers on the chart saying the same thing.
        ["Top 10", concentration ? `${concentration.top10Pct.toFixed(1)}%` : "—"],
        [
          "Creator holds",
          concentration
            ? concentration.devPct === 0
              ? "nothing"
              : `${concentration.devPct.toFixed(1)}%`
            : "—",
        ],
        // "Raised" and "Opened at" were dropped: for a CONFORMING launch both
        // are constants the standard fixes — every one of them raises the same
        // soft cap and opens at the same multiple — so printing them as though
        // they varied was noise, and it made this rail taller than the form
        // beside it.
        [
          "Sold out in",
          `${(fm.soft_cap_deadline_block - fm.start_block).toLocaleString()} block${
            fm.soft_cap_deadline_block - fm.start_block === 1 ? "" : "s"
          }`,
        ],
      ]
    : // A classic fairminter that met its target — "graduated" without a
      // pool to show a spot price for.
      [
        ["Reached", `${(progress * 100).toFixed(1)}%`],
        [
          "Holders",
          `${commas(holderCount ?? participants)}${
            participants ? ` · ${commas(participants)} minted` : ""
          }`,
        ],
        ["Raised", `${commasRaw(fm.paid_quantity)} XCP`],
        ["Supply", compact(supplyTokens)],
      ];

  // Scheduled: a poster, not a terminal — nothing has happened yet, so
  // there is nothing to tabulate. Identity and issuer up top, a living
  // countdown (block wall + heartbeat) in the middle, the standard's fixed
  // terms and a CTA at the bottom. Built to be bookmarked and shared.
  if (phase === "scheduled" || phase === "minting") {
    const minting = phase === "minting";
    // Conformance is editorial and includes the pre-announcement rule, which
    // an in-block launch fails while still having every one of the standard's
    // numbers. Those numbers are what the strip prints and what the form
    // composes, so both key off the parameters rather than the verdict.
    const standardTerms =
      rawEquals(fm.price, XCP69_EXACT.PRICE) &&
      rawEquals(fm.quantity_by_price, XCP69_EXACT.QUANTITY_BY_PRICE) &&
      rawEquals(fm.max_mint_per_address, XCP69_EXACT.MAX_MINT_PER_ADDRESS) &&
      rawEquals(fm.hard_cap, XCP69_EXACT.HARD_CAP) &&
      rawEquals(fm.soft_cap, XCP69_EXACT.SOFT_CAP) &&
      rawEquals(fm.pool_quantity, XCP69_EXACT.POOL_QUANTITY);
    const isUrlDescription = /^https?:\/\//i.test(fm.description ?? "");
    const blocksLeft = fm.start_block - blockHeight;
    // "opens in now" is what blocksEta returns at the boundary, where the
    // record is still pending but the chain has caught up.
    const shareHeadline =
      phase === "minting"
        ? `${(saleProgress(fm) * 100).toFixed(0)}% minted`
        : blocksLeft > 0
          ? `minting opens in ${blocksEta(blocksLeft)}`
          : "minting opens this block";
    // Only a conforming launch has the standard's terms to advertise.
    const shareSubline = conforming
      ? "0.01 XCP / 1,000 · sells out or refunds"
      : "an XCP fairminter on xcp.fun";
    const prose = (fm.description ?? "").trim();
    const hasProse =
      prose.length > 12 && prose.toUpperCase() !== asset.toUpperCase();
    // Only real prose earns the space: a URL is machine metadata, and a
    // one-word "description" is noise the poster reads better without.
    // Shared between phases since it renders in two different spots —
    // before the countdown on scheduled, below the live bar on minting —
    // each needing its own top margin to land in the same visual place.
    const renderDescription = (marginClassName: string) =>
      isOurMetadata(fm.description) ? (
        <HostedDescription url={fm.description} marginClassName={marginClassName} />
      ) : isUrlDescription ? (
        // Someone else's host: link it rather than fetch it, so viewing a
        // launch never reports the visitor to the issuer's server.
        <p className={`${marginClassName} text-sm text-gray-500`}>
          <a
            href={fm.description}
            target="_blank"
            rel="noreferrer nofollow"
            className="break-all text-purple-600 hover:underline"
          >
            {fm.description}
          </a>
        </p>
      ) : (
        hasProse && <LaunchDescription text={prose} marginClassName={marginClassName} />
      );
    return (
      <LaunchRoomProvider asset={asset} fairminterTxHash={fm.tx_hash} enabled={minting}>
      <div className="mx-auto max-w-2xl">
        {/* Identity, on its own — separate from the countdown/mint-form
            card below it, the same way every other phase keeps its header
            apart from its content. */}
        <div className="relative rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
          {/* Art leads on a phone at full width, then steps aside into the
              identity square once there's a column to sit beside. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
            <ArtLightbox asset={asset} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:pr-24">
                <h1 className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight">
                  {asset}
                  <StatusPill phase={phase} hasPool={pool !== null} />
                  {!conforming && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      not XCP-69
                    </span>
                  )}
                </h1>
              </div>
              {/* Share rides the ADDRESS line on a phone, not the heading. The
                  heading carries the status pill, and a 32px button against
                  that is the mismatch that read as a mistake; the address line
                  is a quiet full-width row with nothing on its right, so the
                  button lines up against it instead. Above `sm` the button is
                  absolutely pinned to the card corner, so its position in the
                  markup here costs nothing there. */}
              <div className="flex items-center gap-2 sm:pr-24">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline">
                  <IssuerLine source={fm.source} />
                  <AnnouncedAgo blockIndex={fm.block_index} txHash={fm.tx_hash} />
                </div>
                <div className="shrink-0 sm:absolute sm:right-7 sm:top-7">
                  <ShareButton
                    asset={asset}
                    headline={shareHeadline}
                    subline={shareSubline}
                  />
                </div>
              </div>
              <IssuerChips
                source={fm.source}
                currentAsset={asset}
                trailing={
                  isOurMetadata(fm.description) ? (
                    <HostedSocials url={fm.description} asset={asset} />
                  ) : isInscribed ? (
                    <InscriptionChip txHash={fm.tx_hash} />
                  ) : null
                }
              />
            </div>
          </div>

          {/* The fixed facts (scheduled) or the live number (minting)
              belong with identity — nothing below this card is a "fact
              about the launch" anymore, just the countdown or the form.

              Desktop only. Every value in this strip is fixed by the
              standard, so it is character-for-character identical on every
              XCP-69 launch: price, per-address cap, target, supply. On a
              phone — where a shared link gets opened, and where space is
              scarcest — four numbers that say nothing about THIS launch are
              exactly what should give way. What's left is what differs: the
              art, the name, who's launching it, and when it opens. The terms
              are still a tap away in the countdown's own copy and in the
              docs. */}
          {!minting && standardTerms && (
            <div className="hidden sm:block">
              <TermsStrip xcpUsd={xcpUsd} />
            </div>
          )}
          {minting && mints.length > 0 && (
            <div className="mt-5 border-t border-gray-100 pb-2 pt-2">
              <LiveProgress
                initialEarned={fm.earned_quantity ?? 0}
                target={saleTarget(fm)}
                allOrNothing={big(fm.pool_quantity) > 0n}
                divisible={fm.divisible}
                serverStatus={fm.status}
              />
            </div>
          )}
          {renderDescription("mt-5")}
        </div>

        {minting ? (
          /* MintPanel brings its own card chrome — the same shape the
             swap/limit/dispense forms use — so it isn't nested inside a
             second one here. */
          <div className="mt-4">
            {standardTerms && <MintPanel asset={asset} xcpUsd={xcpUsd} />}
          </div>
        ) : (
          <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
            <ScheduledPulse
              asset={asset}
              startBlock={fm.start_block}
              deadlineBlock={fm.soft_cap_deadline_block}
              initialHeight={blockHeight}
              mintForm={
                standardTerms ? (
                  <MintPanel asset={asset} xcpUsd={xcpUsd} />
                ) : undefined
              }
            />
            {standardTerms && (
              <Link
                href="/dispense"
                className="mt-6 block w-full rounded-2xl bg-purple-600 px-5 py-3.5 text-center font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99]"
              >
                Get XCP before it opens
              </Link>
            )}
          </div>
        )}

        {/* How the sale is actually going — the live progress number now
            sits above, where the description used to be. These facts are
            the rest of it: still live, still not a repeat of the fixed
            terms that ran once on the scheduled poster. */}
        {minting && mints.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-3xl border border-gray-200 bg-white p-5 sm:grid-cols-4">
            <RaisedStat paidQuantity={fm.paid_quantity} xcpUsd={xcpUsd} progress={progress} />
            {feeSats && feeSats.mints > 0 && (
              <TxFeesStat totalFeeSats={feeSats.totalFeeSats} btcUsd={btcUsd} />
            )}
            <ParticipantsStat participants={participants} />
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className={LABEL}>
                  Deadline
                </div>
                {xcpUsd !== null && <DenomToggle visibleOn="desktop" />}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
                {fm.soft_cap_deadline_block - blockHeight > 0
                  ? `Block ${commas(fm.soft_cap_deadline_block)}`
                  : "closing"}
              </div>
            </div>
          </div>
        )}

        {/* Who has minted so far — the sale's own tape, under the card. */}
        {minting && (
          <div className="mt-4">
            <ActivityTabs
              asset={asset}
              mints={mints}
              divisible={fm.divisible}
              minting
              issuerSource={fm.source}
              blockHeight={blockHeight}
            />
          </div>
        )}
      </div>
      </LaunchRoomProvider>
    );
  }

  // Refunded: the same header, card, and stat-cell grammar every other
  // phase uses — the "\u{1F480} RIP" pill is what says this one's over, not a
  // different-looking page. There's no market, no live holders (supply was
  // destroyed), no orders, so there's no edit affordance and no CTA, and
  // the record of who showed up is a plain list rather than the
  // trading-terminal activity tabs, whose Trades/Holders/Orders tabs would
  // just be empty here.
  if (phase === "refunded") {
    const topMinters = minterAddresses.slice(0, 8);
    const extraMinters = minterAddresses.length - topMinters.length;
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
          {/* Same header shape as every other phase — compact art beside
              identity, issuer chips and all. The pill alone says this one's
              over; nothing else about the chrome needs to look different. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
            <ArtLightbox asset={asset} />
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight">
                {asset}
                <StatusPill phase={phase} hasPool={false} />
                {!conforming && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    not XCP-69
                  </span>
                )}
              </h1>
              <div className="flex flex-wrap items-baseline">
                <IssuerLine source={fm.source} />
              </div>
              <IssuerChips
                source={fm.source}
                currentAsset={asset}
                trailing={isInscribed ? <InscriptionChip txHash={fm.tx_hash} /> : null}
              />
            </div>
          </div>

          {/* Two facts, same weight — when, and what came back. Neither
              is the headline; they're just what happened. */}
          <div className="mt-6 grid grid-cols-2 divide-x divide-gray-100 border-t border-gray-100 pt-5 text-center">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Failed on
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-gray-900">
                <BlockMonthYear blockIndex={fm.soft_cap_deadline_block} />
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Refunded
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-gray-900">
                {commasRaw(fm.paid_quantity)}{" "}
                <span className="text-base font-semibold text-gray-400">XCP</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-3xl border border-gray-200 bg-white p-5 sm:grid-cols-4">
          <div>
            <div className={LABEL}>
              Holders
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {participants}
            </div>
          </div>
          <div>
            <div className={LABEL}>
              Mints
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {mints.length}
            </div>
          </div>
          <div>
            <div className={LABEL}>
              Reached
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {(progress * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className={LABEL}>
              Closed
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              <BlockAgo blockIndex={fm.soft_cap_deadline_block} />
            </div>
          </div>
        </div>

        {topMinters.length > 0 && (
          <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-5">
            <div className={LABEL}>
              Who was here
            </div>
            <ul className="mt-3 divide-y divide-gray-100">
              {topMinters.map((source, i) => (
                <li
                  key={source}
                  className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs text-gray-400 tabular-nums">
                      {i + 1}
                    </span>
                    <AddressHoverCard
                      source={source}
                      className="flex min-w-0 items-center gap-2 font-mono text-gray-600 hover:text-purple-700"
                    >
                      <Identicon address={source} />
                      <span className="truncate">{shortAddress(source)}</span>
                    </AddressHoverCard>
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-500">
                    {commas(tokenQty(byAddress.get(source) ?? 0n, fm.divisible))}{" "}
                    {asset}
                  </span>
                </li>
              ))}
            </ul>
            {extraMinters > 0 && (
              <a
                href={`https://xcp.io/asset/${asset}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs font-medium text-purple-600 hover:underline"
              >
                +{extraMinters} more on the explorer ↗
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Identity, same shape every other phase uses: compact art with its
          own lightbox, issuer line with copy + hover card, announced-ago,
          issuer chips, share button in the standard corner. Only the "one
          number worth reading from across the room" changes per phase —
          here it's spot price instead of a countdown or a refund total. */}
      <div className="relative rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <ArtLightbox asset={asset} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 sm:pr-24">
              <h1 className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight">
                {asset}
                <StatusPill phase={phase} hasPool={pool !== null} />
                {!conforming && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    not XCP-69
                  </span>
                )}
              </h1>
            </div>
            {/* Share rides the address line on a phone — see the note on the
                scheduled/minting card above; same reasoning, same shape. */}
            <div className="flex items-center gap-2 sm:pr-24">
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline">
                <IssuerLine source={fm.source} />
                <AnnouncedAgo blockIndex={fm.block_index} txHash={fm.tx_hash} />
              </div>
              <div className="shrink-0 sm:absolute sm:right-7 sm:top-7">
                <ShareButton
                  asset={asset}
                  headline={pool ? `${formatPrice(spot)} XCP` : "minted out"}
                  subline={
                    conforming
                      ? "0.01 XCP / 1,000 · sells out or refunds"
                      : "an XCP fairminter on xcp.fun"
                  }
                />
              </div>
            </div>
            {/* Issuer-history chips ("first launch", "3rd launch") answer
                "should I trust this creator" — the question before minting.
                Once an asset has graduated it has its own track record;
                "first launch" here reads as "first launch on the site",
                not "this issuer's first launch". Facts about the ASSET
                replace them; the issuer stays named in the line above. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pool && (
                <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 tabular-nums">
                  graduated <BlockAgo blockIndex={fm.soft_cap_deadline_block} />
                </span>
              )}
              {holderCount !== null && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 tabular-nums">
                  {commas(holderCount)} holder{holderCount === 1 ? "" : "s"}
                </span>
              )}
              {isOurMetadata(fm.description) ? (
                <HostedSocials url={fm.description} asset={asset} />
              ) : isInscribed ? (
                <InscriptionChip txHash={fm.tx_hash} />
              ) : null}
            </div>
          </div>
        </div>

        {displayDescription && (
          <LaunchDescription text={displayDescription} marginClassName="mt-4" />
        )}

        {/* The three numbers people actually come for. Market cap and volume
            used to be buried among seven equal-weight facts below the chart;
            price was alone up here. */}
        {/* Two, either side — the same shape the refunded state uses. Volume
            is a real number but not one of the two people lead with, so it
            moved down to the rail beside the swap form. */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 text-center">
          {pool ? (
            <>
              <Factoid
                label="Market cap"
                value={mcapUsd ? usd(mcapUsd) : "—"}
                sub={`${compact(spot * supplyTokens)} XCP · ${compact(supplyTokens)} supply`}
              />
              {/* The mint multiple moved to the rail: four numbers here against
                  two on the left was what made the pair look lopsided. */}
              <Factoid
                label="Price"
                value={xcpPriceLabel(spot)}
                // The change lives on the sub line: at eight decimals the
                // price is the widest thing on the row, and hanging a
                // percentage off it made it wider still.
                sub={
                  <>
                    {xcpUsd ? usd(spot * xcpUsd) : null}
                    {xcpUsd && change !== null ? " · " : null}
                    {change !== null && (
                      <span
                        className={change >= 0 ? "text-green-600" : "text-red-600"}
                      >
                        {change >= 0 ? "+" : ""}
                        {change.toFixed(1)}% since mint
                      </span>
                    )}
                  </>
                }
              />
            </>
          ) : (
            <div className="col-span-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Minted out
              </div>
              <div className="mt-1 text-2xl font-bold text-gray-400">
                reached {(progress * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>

        {pool && athPrice > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${
                  athPct >= 99.5 ? "bg-green-500" : "bg-purple-500"
                }`}
                style={{ width: `${athPct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-gray-500 tabular-nums">
              {athPct >= 99.5 ? "at ATH" : `${athPct.toFixed(0)}% of ATH`}{" "}
              <span className="text-gray-400">{xcpPriceLabel(athPrice)}</span>
            </span>
          </div>
        )}
      </div>

      <EditPanel asset={asset} />

      {phase === "graduated" && pool && (
        <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-4">
          <PriceChart
            asset={asset}
            candles={candles}
            xcpUsd={xcpUsd}
            devTrades={devTrades}
          />
        </div>
      )}

      <div className="mt-4">
      <div className="min-w-0 space-y-4">

      {phase === "graduated" && pool && (
        <PressurePanel activity={poolVolume} xcpUsd={xcpUsd} />
      )}

      {phase === "graduated" && pool && conforming && (
        <AssetTradeSurface
          asset={asset}
          xcpUsd={xcpUsd}
          aside={
            <dl className="mt-4 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white sm:mt-0">
              {strip.map(([label, value], i) => (
                <div
                  key={label}
                  // Facts that still move, then those settled at launch.
                  className={`px-4 py-2.5 ${i === LIVE_FACTS ? "border-t-4 border-t-gray-100" : ""}`}
                >
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          }
        />
      )}

      {/* Classic (non-pool) fairminter that met its target — relaxed mode only */}
      {phase === "graduated" && !pool && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Minted out</h2>
          <p className="mt-1.5 text-sm text-gray-600">
            Reached {(progress * 100).toFixed(1)}% with {participants}{" "}
            participants. A classic fairminter — no pool, no locked liquidity;
            distribution only.
          </p>
        </div>
      )}

      {/* The receipt — consensus guarantees as chips; expand to verify */}

      {/* Issuer-only metadata curation; renders nothing for everyone else */}

      {/* Activity: the trade tape and live holders. Inside a room so the tape
          arrives over the launch's shared socket instead of three separate
          per-visitor polls. */}
      <LaunchRoomProvider asset={asset} fairminterTxHash={fm.tx_hash} enabled>
      <ActivityTabs
        asset={asset}
        mints={mints}
        divisible={fm.divisible}
        issuerSource={fm.source}
        poolXcpRaw={pool ? String(poolXcpRaw) : undefined}
        poolTokensRaw={pool ? String(poolTokensRaw) : undefined}
      />
      </LaunchRoomProvider>
      </div>
      </div>
    </div>
  );
}

/** Deterministic address identicon: two hues from a cheap string hash. */
/**
 * A price in XCP at full precision, always carrying its unit.
 *
 * XCP divides to eight places, so that is the whole of a price and nothing is
 * rounded away. The unit is never dropped: an unlabelled sub-one number in a
 * crypto UI reads as bitcoin to most people, and these are XCP.
 */
const xcpPriceLabel = (xcpPrice: number) =>
  `${xcpPrice.toLocaleString("en-US", {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  })} XCP`;

/** Facts that still move, before those settled at launch. */
const LIVE_FACTS = 3;

/** One of the three headline numbers: label, the number, an optional second
 *  line, and an optional accent (the price's own change figure). */
function Factoid({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="mt-1 break-words text-base font-bold leading-tight tabular-nums text-gray-900 sm:text-xl">
        {value}
        {accent}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export function Identicon({ address }: { address: string }) {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  const h1 = h % 360;
  const h2 = (h >> 9) % 360;
  return (
    <span
      aria-hidden
      className="inline-block size-4 shrink-0 rounded-full align-text-bottom"
      style={{
        background: `linear-gradient(135deg, hsl(${h1} 70% 60%), hsl(${h2} 70% 42%))`,
      }}
    />
  );
}
