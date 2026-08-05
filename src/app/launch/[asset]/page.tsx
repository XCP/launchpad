import { notFound } from "next/navigation";
import { TokenImage } from "@/components/token-image";
import {
  fetchBlockHeight,
  fetchFairmints,
  fetchFairmintersByAsset,
  fetchPool,
} from "@/lib/api/counterparty";
import { blocksEta, commas, compact, fromSats, shortAddress } from "@/lib/format";
import {
  isXcp69,
  launchPhase,
  openingMultiple,
  saleProgress,
  saleTarget,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";
import { MintPanel } from "./mint-panel";

export const revalidate = 30;

export default async function LaunchPage({
  params,
}: {
  params: Promise<{ asset: string }>;
}) {
  const { asset: rawAsset } = await params;
  const asset = decodeURIComponent(rawAsset).toUpperCase();

  const fairminters = await fetchFairmintersByAsset(asset);
  const fm =
    fairminters.find(isXcp69) ??
    (SHOW_NONCONFORMING
      ? fairminters.find((f) => !f.status.startsWith("invalid"))
      : undefined);
  if (!fm) notFound();
  const conforming = isXcp69(fm);

  const [mints, blockHeight, pool] = await Promise.all([
    fetchFairmints(fm.tx_hash),
    fetchBlockHeight(),
    fm.status === "closed" ? fetchPool(asset) : Promise.resolve(null),
  ]);
  const phase = launchPhase(fm, pool !== null);
  const progress = saleProgress(fm);

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
      {/* Identity */}
      <div className="flex items-center gap-4">
        <TokenImage asset={asset} className="size-14 rounded-full bg-gray-100" />
        <div>
          <h1 className="text-2xl font-bold">{asset}</h1>
          <p className="text-sm text-gray-500">
            by {shortAddress(fm.source)} · {phase}
            {!conforming && (
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
          {/* Progress */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-lg font-bold">
                {(progress * 100).toFixed(1)}%
              </span>
              <span className="text-sm text-gray-500">
                {compact(fromSats(fm.earned_quantity))} /{" "}
                {compact(fromSats(saleTarget(fm)))}
                {(fm.pool_quantity ?? 0) > 0 ? " · sells out or refunds" : ""}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-purple-600"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <Stat
                label="XCP raised"
                value={commas(fromSats(fm.paid_quantity))}
              />
              <Stat
                label="Time left"
                value={blocksEta(fm.soft_cap_deadline_block - blockHeight)}
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
          {conforming && <MintPanel asset={asset} />}

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
        <div className="holo-border rounded-lg p-5">
          <h2 className="font-semibold">Graduated — liquidity locked</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <Stat
              label="Pool XCP"
              value={commas(Number(pool.reserve_b_normalized ?? fromSats(pool.reserve_b)))}
            />
            <Stat
              label="Pool tokens"
              value={compact(Number(pool.reserve_a_normalized ?? fromSats(pool.reserve_a)))}
            />
            <Stat label="Participants" value={String(participants)} />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            LP tokens were minted to the unspendable address — nobody can ever
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
                <span className="font-mono text-gray-600">
                  {shortAddress(m.source)}
                </span>
                <span className="text-gray-900">
                  {compact(fromSats(m.earn_quantity))}{" "}
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
