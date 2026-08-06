import { TokenImage } from "@/components/token-image";
import type { Fairmint, Pool, PoolSnapshot } from "@/lib/api/counterparty";
import {
  blocksEta,
  commas,
  compact,
  fromSats,
  shortAddress,
  tokenQty,
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
import { EditPanel } from "./edit-panel";
import { LiveProgress } from "./live-progress";
import { MintPanel } from "./mint-panel";
import { PriceChart } from "./price-chart";
import { TradePanel } from "./trade-panel";

/**
 * The launch page's entire presentation, data in via props — shared by the
 * real /[asset] route and the /preview state simulator so the two can never
 * drift. No fetching happens here.
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

  return (
    <div className="space-y-8">
      {/* Identity — the art leads */}
      <div className="flex items-center gap-5">
        <TokenImage
          asset={asset}
          large
          className="size-24 rounded-2xl bg-gray-100 object-cover shadow-sm"
        />
        <div>
          <h1 className="text-3xl font-bold">{asset}</h1>
          <p className="mt-1 text-sm text-gray-500">
            by {shortAddress(fm.source)} · {phase}
            {conforming ? (
              <span
                className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700"
                title="Conforms to the XCP-69 standard — every field checked against the fairminter record"
              >
                XCP-69 ✓
              </span>
            ) : (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                not XCP-69
              </span>
            )}
          </p>
        </div>
      </div>

      {phase === "scheduled" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
          Minting opens at block {fm.start_block.toLocaleString()} —{" "}
          {blocksEta(fm.start_block - blockHeight)} from now.
        </div>
      )}

      {phase === "minting" && (
        <>
          {(fm.pool_quantity ?? 0) > 0 && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
              <strong>
                {compact(fromSats(saleTarget(fm)))} minted, or everyone is
                refunded.
              </strong>{" "}
              {Math.max(0, fm.soft_cap_deadline_block - blockHeight).toLocaleString()}{" "}
              blocks ({blocksEta(fm.soft_cap_deadline_block - blockHeight)})
              left — every mint stays escrowed by consensus until it resolves.
            </div>
          )}

          {/* Progress — server-rendered baseline, then live with mempool overlay */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <LiveProgress
              fairminterTxHash={fm.tx_hash}
              initialEarned={fm.earned_quantity ?? 0}
              target={saleTarget(fm)}
              allOrNothing={(fm.pool_quantity ?? 0) > 0}
              divisible={fm.divisible}
            />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <Stat
                label="XCP raised"
                value={`${commas(fromSats(fm.paid_quantity))}${
                  xcpUsd ? ` (≈${usd(fromSats(fm.paid_quantity) * xcpUsd)})` : ""
                }`}
              />
              <Stat
                label="Time left"
                value={
                  fm.soft_cap_deadline_block > 0
                    ? blocksEta(fm.soft_cap_deadline_block - blockHeight)
                    : "no deadline"
                }
              />
              <Stat
                label="At close"
                value={
                  openingMultiple(fm)
                    ? `pool opens ${openingMultiple(fm)!.toFixed(2)}× mint`
                    : "no pool"
                }
              />
            </div>
          </div>

          {/* Mint — the panel's lot math assumes the standard's parameters */}
          {conforming && <MintPanel asset={asset} xcpUsd={xcpUsd} />}

          {/* Organic panel */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">How organic does it look?</h2>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <Stat
                label="Distinct addresses"
                value={`${participants} / ${XCP69_MIN_PARTICIPANTS}+`}
              />
              <Stat
                label="Top address share"
                value={`${(topShare * 100).toFixed(1)}% (cap 1.45%)`}
              />
              <Stat label="Mints" value={String(mints.length)} />
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Success requires at least {XCP69_MIN_PARTICIPANTS} distinct
              addresses. The cap is per address, not per person — it raises the
              cost of faking a crowd, it cannot prevent one.
            </p>
          </div>
        </>
      )}

      {phase === "graduated" && pool && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <PriceChart
            asset={asset}
            history={priceHistory}
            blockHeight={blockHeight}
            xcpUsd={xcpUsd}
          />
        </div>
      )}

      {phase === "graduated" && pool && conforming && <TradePanel asset={asset} />}

      {phase === "graduated" && pool && (
        <div className="holo-border rounded-lg p-5">
          <h2 className="font-semibold">Graduated — liquidity locked</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <Stat
              label="Pool XCP"
              value={`${commas(poolXcp)}${
                xcpUsd ? ` (≈${usd(poolXcp * xcpUsd)})` : ""
              }`}
            />
            <Stat label="Pool tokens" value={compact(poolTokens)} />
            <Stat label="Participants" value={String(participants)} />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            LP tokens (
            <span className="font-mono">{pool.lp_asset}</span>
            {isHouseLpName(pool.lp_asset) && (
              <span title="House format: starts 69, ends 69, ≡ 69 (mod 97)">
                {" "}
                ✓
              </span>
            )}
            ) were minted to the unspendable address — nobody can ever
            withdraw this liquidity. Trading interface coming here next.
          </p>
        </div>
      )}

      {phase === "refunded" && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-semibold text-gray-700">
            Refunded — soft cap not reached
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Reached {(progress * 100).toFixed(1)}% with {participants}{" "}
            participants. All {commas(fromSats(fm.paid_quantity))} XCP was
            refunded by the protocol and the escrowed supply destroyed.
          </p>
        </div>
      )}

      {/* Classic (non-pool) fairminter that met its target — relaxed mode only */}
      {phase === "graduated" && !pool && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-semibold">Minted out</h2>
          <p className="mt-2 text-sm text-gray-600">
            Reached {(progress * 100).toFixed(1)}% with {participants}{" "}
            participants. A classic fairminter — no pool, no locked liquidity;
            distribution only.
          </p>
        </div>
      )}

      {/* The receipt — consensus guarantees, not platform promises */}
      {conforming && <Guarantees fm={fm} />}

      {/* Issuer-only metadata curation; renders nothing for everyone else */}
      <EditPanel asset={asset} issuer={fm.source} />

      {/* Mint tape */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 p-4 font-semibold">
          Mints ({mints.length})
        </h2>
        {mints.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            No mints yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {mints.slice(0, 100).map((m) => (
              <li
                key={m.tx_hash}
                className="flex items-center justify-between px-4 py-2 text-sm"
              >
                <span className="flex items-center gap-2 font-mono text-gray-600">
                  <Identicon address={m.source} />
                  {shortAddress(m.source)}
                </span>
                <span className="text-gray-900">
                  {compact(tokenQty(m.earn_quantity, fm.divisible))}{" "}
                  <span className="text-gray-400">
                    ({commas(fromSats(m.paid_quantity))} XCP)
                  </span>
                </span>
                <span className="text-xs text-gray-400">
                  block {m.block_index}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/**
 * The inversion of a memecoin launchpad's "Audit" box: where those detect
 * rug vectors heuristically after the fact, XCP-69 forbids them by consensus.
 * Static by design — every conforming launch earns the identical receipt.
 */
function Guarantees({ fm }: { fm: Fairminter }) {
  const announcedLead =
    fm.start_block > 0 && fm.block_index < fm.start_block
      ? `announced on-chain ${(fm.start_block - fm.block_index).toLocaleString()} blocks before minting could open`
      : "announced on-chain before minting could open";
  const rows: [string, string][] = [
    ["No premine", "0 tokens existed before the launch — consensus rejects the XCP-69 shape on any asset with prior supply, and premint is pinned to zero"],
    ["No commission", "0% of any mint is skimmed to the creator"],
    ["No sniping", announcedLead + " — early mints are rejected by consensus"],
    ["No bundling past the cap", "10 XCP per address, enforced per-address by consensus"],
    ["No creator take", "100% of raised XCP becomes pool liquidity at close"],
    ["No rug", "LP tokens are minted to the unspendable address — liquidity can never be withdrawn"],
  ];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">The receipt</h2>
      <p className="mt-1 text-xs text-gray-500">
        Not platform policy — protocol consensus. Every row is verifiable
        against any Counterparty node from this launch&apos;s on-chain record.
      </p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map(([claim, how]) => (
          <div key={claim} className="flex gap-2 rounded-md bg-gray-50 p-2.5">
            <span aria-hidden className="font-semibold text-green-600">
              ✓
            </span>
            <div>
              <dt className="text-sm font-medium text-gray-900">{claim}</dt>
              <dd className="mt-0.5 text-xs text-gray-600">{how}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Deterministic address identicon: two hues from a cheap string hash. */
function Identicon({ address }: { address: string }) {
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
