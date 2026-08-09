import Link from "next/link";
import { TokenImage } from "@/components/token-image";
import {
  ArtLightbox,
  HostedDescription,
  HostedSocials,
  IssuerChips,
  ScheduledPulse,
} from "./scheduled-extras";
import { Hint } from "@/components/ui/tooltip";
import type { Fairmint, Pool, PoolSnapshot } from "@/lib/api/counterparty";
import {
  blocksEta,
  commas,
  compact,
  fromSats,
  price as formatPrice,
  shortAddress,
  usd,
} from "@/lib/format";
import {
  type Fairminter,
  isHouseLpName,
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
}) {
  const progress = saleProgress(fm);
  // sort_pair orders the pool lexically — XCP can sit on either side.
  const xcpIsA = pool?.asset_a === "XCP";
  const poolXcp = pool
    ? Number(
        (xcpIsA ? pool.reserve_a_normalized : pool.reserve_b_normalized) ??
          fromSats(xcpIsA ? pool.reserve_a : pool.reserve_b),
      )
    : 0;
  const poolTokens = pool
    ? Number(
        (xcpIsA ? pool.reserve_b_normalized : pool.reserve_a_normalized) ??
          fromSats(xcpIsA ? pool.reserve_b : pool.reserve_a),
      )
    : 0;

  // Organic-look aggregates — the survival predictors as UI.
  const byAddress = new Map<string, number>();
  for (const m of mints) {
    byAddress.set(m.source, (byAddress.get(m.source) ?? 0) + m.earn_quantity);
  }
  const participants = byAddress.size;
  const topShare =
    fm.earned_quantity && byAddress.size > 0
      ? Math.max(...byAddress.values()) / fm.earned_quantity
      : 0;

  // "How's it doing" numbers (graduated): spot from the pool, change over
  // the available history, multiple vs the fixed mint price.
  const mintPrice =
    fm.quantity_by_price > 0 ? fm.price / fm.quantity_by_price : 0;
  const spot = poolTokens > 0 ? poolXcp / poolTokens : 0;
  const first = priceHistory[0];
  const firstPrice =
    first && first.reserve_a > 0 && first.reserve_b > 0
      ? (first.asset_a === "XCP" ? first.reserve_a : first.reserve_b) /
        (first.asset_a === "XCP" ? first.reserve_b : first.reserve_a)
      : 0;
  const change = firstPrice > 0 && spot > 0 ? (spot / firstPrice - 1) * 100 : null;
  const multiple = mintPrice > 0 && spot > 0 ? spot / mintPrice : null;
  const supplyTokens = fromSats(fm.hard_cap);
  const mcapUsd = xcpUsd && spot > 0 ? spot * supplyTokens * xcpUsd : null;

  const hasAside =
    (phase === "minting" && conforming) ||
    (phase === "graduated" && pool !== null);

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
    ) : phase === "scheduled" ? (
      <div className="text-right">
        <div className="text-xl font-bold text-gray-900">
          {blocksEta(fm.start_block - blockHeight)}
        </div>
        <div className="mt-0.5 text-xs text-gray-500">until minting opens</div>
      </div>
    ) : (
      <div className="text-right">
        <div className="text-xl font-bold text-gray-400">
          {phase === "refunded" ? "refunded" : "minted out"}
        </div>
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
              `${commas(fromSats(fm.paid_quantity))} XCP${
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
        : phase === "scheduled"
          ? [
              ["Opens", `block ${fm.start_block.toLocaleString()}`],
              ["Window", "1,000 blocks (~1 week)"],
              ["Lot price", "0.01 XCP / 1,000 tokens"],
              ["Per-address cap", "10 XCP"],
            ]
          : [
              ["Reached", `${(progress * 100).toFixed(1)}%`],
              ["Participants", String(participants)],
              [
                phase === "refunded" ? "Returned" : "Raised",
                `${commas(fromSats(fm.paid_quantity))} XCP`,
              ],
              ["Supply", phase === "refunded" ? "destroyed" : compact(supplyTokens)],
            ];

  // Scheduled: a poster, not a terminal — nothing has happened yet, so
  // there is nothing to tabulate. Identity and issuer up top, a living
  // countdown (block wall + heartbeat) in the middle, the standard's fixed
  // terms and a CTA at the bottom. Built to be bookmarked and shared.
  if (phase === "scheduled") {
    const isUrlDescription = /^https?:\/\//i.test(fm.description ?? "");
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
          <div className="flex items-start gap-4 sm:gap-5">
            <ArtLightbox asset={asset} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h1 className="min-w-0 flex-1 text-2xl font-extrabold leading-tight tracking-tight sm:text-[1.7rem]">
                  {asset}{" "}
                  {conforming && (
                    <span
                      className="ml-0.5 inline-block translate-y-[-3px] rounded bg-green-50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-green-700"
                      title="Conforms to the XCP-69 standard — every field checked against the fairminter record"
                    >
                      XCP-69 ✓
                    </span>
                  )}
                </h1>
                {isUrlDescription && (
                  <HostedSocials url={fm.description} asset={asset} />
                )}
              </div>
              <p className="mt-1 text-[13px] text-gray-500 tabular-nums">
                by{" "}
                <a
                  href={`https://xcp.io/address/${fm.source}`}
                  target="_blank"
                  rel="noreferrer"
                  title={fm.source}
                  className="hover:text-purple-600 hover:underline"
                >
                  <span className="hidden sm:inline">{fm.source}</span>
                  <span className="sm:hidden">{shortAddress(fm.source)}</span>
                </a>
              </p>
              <IssuerChips source={fm.source} currentAsset={asset} />
            </div>
          </div>

          {fm.description &&
            (isUrlDescription ? (
              <HostedDescription url={fm.description} />
            ) : (
              <p className="mt-4 text-sm leading-relaxed text-gray-600">
                {fm.description}
              </p>
            ))}

          <ScheduledPulse
            asset={asset}
            startBlock={fm.start_block}
            announceBlock={fm.block_index}
            initialHeight={blockHeight}
          />

          {conforming && (
            <>
              <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-gray-100 pt-5 sm:grid-cols-4">
                {(
                  [
                    ["Price", "0.01 XCP / 1,000"],
                    ["Per address", "10 XCP · 1M max"],
                    ["Target", "690 XCP or refund"],
                    ["Supply", "100M · 31M pool"],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                      {label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <Link
                href="/dispense"
                className="mt-5 block w-full rounded-2xl bg-purple-600 px-5 py-3.5 text-center font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99]"
              >
                Get XCP before it opens
              </Link>
            </>
          )}
        </div>
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
            {conforming ? (
              <span
                className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700"
                title="Conforms to the XCP-69 standard — every field checked against the fairminter record"
              >
                XCP-69 ✓
              </span>
            ) : (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
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
          {phase === "minting" && conforming && (
            <MintPanel asset={asset} xcpUsd={xcpUsd} />
          )}
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
                <span title="House format: starts 69, ends 69, ≡ 69 (mod 97)"> ✓</span>
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
      {phase === "minting" && (
        <>
          {(fm.pool_quantity ?? 0) > 0 && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
              <strong>
                {compact(fromSats(saleTarget(fm)))} minted, or everyone is
                refunded
              </strong>{" "}
              — every mint stays escrowed by consensus until it resolves.
            </div>
          )}

          {/* Progress — server-rendered baseline, then live with mempool overlay */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <LiveProgress
              fairminterTxHash={fm.tx_hash}
              initialEarned={fm.earned_quantity ?? 0}
              target={saleTarget(fm)}
              allOrNothing={(fm.pool_quantity ?? 0) > 0}
              divisible={fm.divisible}
            />
          </div>
        </>
      )}

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

      {phase === "refunded" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">
            Refunded by consensus — the guarantee executed
          </h2>
          <p className="mt-1.5 text-sm text-gray-600">
            Reached {(progress * 100).toFixed(1)}% with {participants} of the
            69 addresses a sellout requires. Every one of the{" "}
            {commas(fromSats(fm.paid_quantity))} XCP escrowed was returned by
            the protocol and the unsold supply destroyed. Nobody was left
            holding a dead token — this is what the guarantee is for.
          </p>
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
