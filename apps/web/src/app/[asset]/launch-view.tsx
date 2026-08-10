import Link from "next/link";
import { TokenImage } from "@/components/token-image";
import {
  AddressHoverCard,
  AnnouncedAgo,
  ArtLightbox,
  BlockAgo,
  DenomToggle,
  HostedDescription,
  HostedSocials,
  IssuerChips,
  isOurMetadata,
  IssuerLine,
  LaunchDescription,
  ParticipantsStat,
  RaisedStat,
  ScheduledPulse,
  ShareButton,
  StatusPill,
  TermsStrip,
  TxFeesStat,
} from "./scheduled-extras";
import { Hint } from "@/components/ui/tooltip";
import type { Fairmint, Pool, PoolSnapshot } from "@/lib/api/counterparty";
import type { FeeSummary } from "@/lib/api/launchpad-api";
import { LaunchRoomProvider } from "@/lib/launch-room";
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
import { big, maxRaw, ratio, rawEquals } from "@/lib/numeric";
import {
  type Fairminter,
  isHouseLpName,
  XCP69_EXACT,
  type LaunchPhase,
  openingMultiple,
  saleProgress,
  saleTarget,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";
import { ActivityTabs } from "./activity-tabs";
import { AssetTradeSurface } from "./asset-trade-surface";
import { EditPanel } from "./edit-panel";
import { LiveProgress } from "./live-progress";
import { MintPanel } from "./mint-panel";
import { PriceChart } from "./price-chart";

/**
 * The launch page's entire presentation, data in via props — shared by the
 * real /[asset] route and the phase-preview simulator so the two can never
 * drift. No fetching happens here.
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
  priceHistory,
  xcpUsd,
  btcUsd,
  feeSats,
}: {
  asset: string;
  fm: Fairminter;
  conforming: boolean;
  phase: LaunchPhase;
  blockHeight: number;
  mints: Fairmint[];
  pool: Pool | null;
  priceHistory: PoolSnapshot[];
  xcpUsd: number | null;
  btcUsd: number | null;
  feeSats: FeeSummary | null;
}) {
  const progress = saleProgress(fm);
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
  const topShare =
    byAddress.size > 0
      ? ratio([...byAddress.values()].reduce(maxRaw, 0n), fm.earned_quantity)
      : 0;
  // Biggest minters first — the addresses worth checking for freshness.
  const minterAddresses = [...byAddress.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([source]) => source);

  // "How's it doing" numbers (graduated): spot from the pool, change over
  // the available history, multiple vs the fixed mint price.
  const mintPrice = ratio(fm.price, fm.quantity_by_price);
  const spot = poolTokens > 0 ? poolXcp / poolTokens : 0;
  const first = priceHistory[0];
  const firstPrice = first
    ? ratio(
        first.asset_a === "XCP" ? first.reserve_a : first.reserve_b,
        first.asset_a === "XCP" ? first.reserve_b : first.reserve_a,
      )
    : 0;
  const change = firstPrice > 0 && spot > 0 ? (spot / firstPrice - 1) * 100 : null;
  const multiple = mintPrice > 0 && spot > 0 ? spot / mintPrice : null;
  const supplyTokens = fromSats(fm.hard_cap);
  const mcapUsd = xcpUsd && spot > 0 ? spot * supplyTokens * xcpUsd : null;

  // Minting now renders as a poster (above); the terminal layout is for
  // launches with a market to look at.
  const hasAside = phase === "graduated" && pool !== null;

  /* Header right: the one number that answers "how's it doing?" */
  const headline =
    phase === "graduated" && pool ? (
      <div className="text-right">
        <div className="text-xl font-bold tabular-nums text-gray-900">
          {formatPrice(spot)} <span className="text-sm font-medium text-gray-500">XCP</span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {xcpUsd ? `${usd(spot * xcpUsd)} · ` : ""}
          {multiple ? `${multiple.toFixed(2)}× mint` : ""}
          {change !== null && (
            <span
              className={`ml-1.5 font-semibold ${
                change >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    ) : phase === "minting" ? (
      <div className="text-right">
        <div className="text-xl font-bold tabular-nums text-gray-900">
          {(progress * 100).toFixed(1)}%{" "}
          <span className="text-sm font-medium text-gray-500">sold</span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {fm.soft_cap_deadline_block > 0
            ? `${blocksEta(fm.soft_cap_deadline_block - blockHeight)} left`
            : "no deadline"}
        </div>
      </div>
    ) : (
      // Refunded gets its own tombstone view entirely (see below); this
      // fallback is only reached by a classic (non-pool) fairminter that
      // met its target — "graduated" without a pool to show a spot price for.
      <div className="text-right">
        <div className="text-xl font-bold text-gray-400">minted out</div>
        <div className="mt-0.5 text-xs text-gray-500">
          reached {(progress * 100).toFixed(1)}%
        </div>
      </div>
    );

  /* The stat strip: dense, phase-specific, no prose. */
  const strip: [string, string, string?][] =
    phase === "graduated" && pool
      ? [
          ["Market cap", mcapUsd ? usd(mcapUsd) : "—"],
          [
            "Sold out in",
            `${(fm.soft_cap_deadline_block - fm.start_block).toLocaleString()} block${
              fm.soft_cap_deadline_block - fm.start_block === 1 ? "" : "s"
            }`,
            "From mint-open to the block that filled the sale — consensus rewrites the deadline to the fill block",
          ],
          [
            "Liquidity",
            `${commas(Math.round(poolXcp))} XCP${
              xcpUsd ? ` (${usd(poolXcp * xcpUsd)})` : ""
            }`,
            "XCP side of the locked pool",
          ],
          ["Supply", compact(supplyTokens)],
          ["Participants", String(participants)],
          [
            "LP",
            isHouseLpName(pool.lp_asset) ? "burned ✓" : "burned",
            `${pool.lp_asset} — minted to the unspendable address; liquidity can never leave`,
          ],
        ]
      : phase === "minting"
        ? [
            [
              "Raised",
              `${commasRaw(fm.paid_quantity)} XCP${
                xcpUsd ? ` (${usd(fromSats(fm.paid_quantity) * xcpUsd)})` : ""
              }`,
            ],
            [
              "At close",
              openingMultiple(fm)
                ? `pool opens ${openingMultiple(fm)!.toFixed(2)}× mint`
                : "no pool",
            ],
            [
              "Participants",
              `${participants} / ${XCP69_MIN_PARTICIPANTS}+`,
              `Success requires at least ${XCP69_MIN_PARTICIPANTS} distinct addresses`,
            ],
            [
              "Top address",
              `${(topShare * 100).toFixed(1)}%`,
              "Share of the sale held by the largest single address (cap 1.45%). Per address, not per person — it raises the cost of faking a crowd, it cannot prevent one.",
            ],
            ["Mints", String(mints.length)],
          ]
        : // Same as above: only a classic fairminter that met its target
          // reaches this fallback now that refunded has its own view.
          [
            ["Reached", `${(progress * 100).toFixed(1)}%`],
            ["Participants", String(participants)],
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
    return (
      <LaunchRoomProvider asset={asset} fairminterTxHash={fm.tx_hash} enabled={minting}>
      <div className="mx-auto max-w-2xl">
        <div className="relative rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
          {/* Art leads on a phone at full width, then steps aside into the
              identity square once there's a column to sit beside. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
            <ArtLightbox asset={asset} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2 sm:pr-24">
                <h1 className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight">
                  {asset}
                  <StatusPill phase={phase} hasPool={pool !== null} />
                  {!conforming && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      not XCP-69
                    </span>
                  )}
                </h1>
                {/* In flow on a phone, pinned to the card's corner above it —
                    the page's own control, so it sits apart from the
                    project's links. */}
                <div className="shrink-0 sm:absolute sm:right-7 sm:top-7">
                  <ShareButton
                    asset={asset}
                    headline={shareHeadline}
                    subline={shareSubline}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-baseline sm:pr-24">
                <IssuerLine source={fm.source} />
                <AnnouncedAgo blockIndex={fm.block_index} txHash={fm.tx_hash} />
              </div>
              <IssuerChips
                source={fm.source}
                currentAsset={asset}
                trailing={
                  isOurMetadata(fm.description) ? (
                    <HostedSocials url={fm.description} asset={asset} />
                  ) : null
                }
              />
            </div>
          </div>

          {standardTerms && !minting && <TermsStrip xcpUsd={xcpUsd} />}

          {/* Once minting is live, the live number IS the description's
              spot — what the launch is about mattered before anything had
              happened; how it's going matters now. */}
          {minting ? (
            mints.length > 0 && (
              <div className="mt-4">
                <LiveProgress
                  initialEarned={fm.earned_quantity ?? 0}
                  target={saleTarget(fm)}
                  allOrNothing={big(fm.pool_quantity) > 0n}
                  divisible={fm.divisible}
                />
              </div>
            )
          ) : /* Only real prose earns the space: a URL is machine metadata,
                 and a one-word "description" is noise the poster reads
                 better without. */
          isOurMetadata(fm.description) ? (
            <HostedDescription url={fm.description} />
          ) : isUrlDescription ? (
            /* Someone else's host: link it rather than fetch it, so viewing a
               launch never reports the visitor to the issuer's server. */
            <p className="mt-5 text-sm text-gray-500">
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
            hasProse && <LaunchDescription text={prose} />
          )}

          {minting ? (
            <div className="mt-6">
              {standardTerms && <MintPanel asset={asset} xcpUsd={xcpUsd} />}
            </div>
          ) : (
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
          )}

          {standardTerms && !minting && (
            <Link
              href="/dispense"
              className="mt-6 block w-full rounded-2xl bg-purple-600 px-5 py-3.5 text-center font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99]"
            >
              Get XCP before it opens
            </Link>
          )}
        </div>

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
            <ParticipantsStat
              participants={participants}
              addresses={minterAddresses}
              blockHeight={blockHeight}
            />
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
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

  // Refunded: the same card, pill, and stat-cell grammar every other phase
  // uses — just told what actually happened here. There's no market, no
  // live holders (supply was destroyed), no orders, so nothing tries to
  // look live: the art is bigger than any other phase's and muted, there's
  // no edit affordance and no CTA, and the record of who showed up is a
  // plain list rather than the trading-terminal activity tabs, whose
  // Trades/Holders/Orders tabs would just be empty here.
  if (phase === "refunded") {
    const topMinters = minterAddresses.slice(0, 8);
    const extraMinters = minterAddresses.length - topMinters.length;
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
          <ArtLightbox asset={asset} size="hero" muted />

          <div className="mt-5">
            <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight">
              {asset}
              <StatusPill phase={phase} hasPool={false} />
              {!conforming && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  not XCP-69
                </span>
              )}
            </h1>
            <div className="mt-1 flex flex-wrap items-baseline">
              <IssuerLine source={fm.source} />
            </div>
            <p className="mt-3 text-sm text-gray-600">
              Reached {(progress * 100).toFixed(1)}% of the sale before the
              deadline. Every XCP escrowed came back and the unsold supply
              was destroyed — the guarantee, not a rescue.
            </p>
          </div>

          {/* The one number worth reading from across the room. */}
          <div className="mt-6 border-t border-gray-100 pt-5 text-center">
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
              Refunded
            </div>
            <div className="mt-1 text-4xl font-bold tabular-nums text-gray-900">
              {commasRaw(fm.paid_quantity)}{" "}
              <span className="text-xl font-semibold text-gray-400">XCP</span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-3xl border border-gray-200 bg-white p-5 sm:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Participants
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {participants}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Mints
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {mints.length}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Reached
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {(progress * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Closed
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              <BlockAgo blockIndex={fm.soft_cap_deadline_block} />
            </div>
          </div>
        </div>

        {topMinters.length > 0 && (
          <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
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
    <div>
      {/* Identity + headline: how's it doing, at a glance */}
      <div className="flex flex-wrap items-center gap-3">
        <TokenImage
          asset={asset}
          large
          className="size-12 rounded-lg bg-gray-100 object-cover shadow-sm"
        />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold leading-tight">
            {asset}
            <StatusPill phase={phase} hasPool={pool !== null} />
            {!conforming && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                not XCP-69
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-xs text-gray-500">
            by {shortAddress(fm.source)} · {phase}
          </p>
        </div>
        <div className="ml-auto">{headline}</div>
      </div>

      {/* Stat strip — the terminal row */}
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-y border-gray-200 py-3">
        {strip.map(([label, value, hint]) => {
          const cell = (
            <div
              className={hint ? "cursor-help" : undefined}
              tabIndex={hint ? 0 : undefined}
            >
              <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                {label}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
                {value}
              </div>
            </div>
          );
          return hint ? (
            <Hint key={label} content={hint}>
              {cell}
            </Hint>
          ) : (
            <div key={label}>{cell}</div>
          );
        })}
      </div>

      <div
        className={
          hasAside
            ? "mt-5 lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start lg:gap-6"
            : "mt-5"
        }
      >
      {/* Aside first (pons grammar): do I want in, do I want out */}
      {hasAside && (
        <aside className="mb-4 min-w-0 space-y-4 lg:mb-0">
          {phase === "graduated" && pool && conforming && (
            <AssetTradeSurface asset={asset} xcpUsd={xcpUsd} />
          )}
          {phase === "graduated" && pool && (
            <div className="holo-border rounded-2xl p-3 text-xs text-gray-600">
              <span className="font-semibold text-gray-900">
                Liquidity locked forever
              </span>{" "}
              — LP <span className="font-mono">{pool.lp_asset}</span>
              {isHouseLpName(pool.lp_asset) && (
                <span> ✓</span>
              )}{" "}
              was minted to the unspendable address. {compact(poolTokens)}{" "}
              {asset} + {commas(Math.round(poolXcp))} XCP can never be
              withdrawn.
            </div>
          )}
        </aside>
      )}

      {/* Main column: chart, story, receipt, activity */}
      <div className="min-w-0 space-y-4">

      {phase === "graduated" && pool && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <PriceChart
            asset={asset}
            history={priceHistory}
            blockHeight={blockHeight}
            xcpUsd={xcpUsd}
          />
        </div>
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
      <EditPanel asset={asset} issuer={fm.source} />

      {/* Activity: the mint tape and live holders */}
      <ActivityTabs asset={asset} mints={mints} divisible={fm.divisible} />
      </div>
      </div>
    </div>
  );
}

/** Deterministic address identicon: two hues from a cheap string hash. */
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
