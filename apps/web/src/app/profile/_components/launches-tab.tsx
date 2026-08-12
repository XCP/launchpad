"use client";

import Link from "next/link";
import useSWR from "swr";
import { EditPanel } from "@/app/[asset]/_components/edit-panel";
import { TokenImage } from "@/components/token-image";
import { fetchMempoolFairminters } from "@/lib/api/counterparty";
import { fetchLaunchesBySource, type MyLaunch } from "@/lib/api/launchpad-api";
import type { LaunchPhase } from "@/lib/xcp69";

const PHASE_LABEL: Record<LaunchPhase, string> = {
  scheduled: "Scheduled",
  minting: "Minting",
  graduated: "Graduated",
  refunded: "Refunded",
};

const PHASE_TONE: Record<LaunchPhase, string> = {
  scheduled: "bg-gray-100 text-gray-600",
  minting: "bg-blue-100 text-blue-700",
  graduated: "bg-green-100 text-green-700",
  refunded: "bg-amber-100 text-amber-700",
};

function ConformingBadge({ conforming }: { conforming: boolean | null }) {
  if (conforming === null) {
    return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Verdict pending</span>;
  }
  return conforming ? (
    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">XCP-69</span>
  ) : (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Non-conforming</span>
  );
}

function LaunchCard({ launch }: { launch: MyLaunch }) {
  return (
    <div className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <Link href={`/${launch.asset}`} className="shrink-0">
        <TokenImage asset={launch.asset} className="size-16 rounded-lg object-cover" />
      </Link>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/${launch.asset}`}
            className="truncate font-semibold text-gray-900 hover:text-purple-600"
          >
            {launch.asset}
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <ConformingBadge conforming={launch.conforming} />
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_TONE[launch.phase]}`}>
              {PHASE_LABEL[launch.phase]}
            </span>
          </div>
        </div>
        <EditPanel asset={launch.asset} />
      </div>
    </div>
  );
}

/** Launches this address CREATED — keyed on the fairminter's source, which
 *  never changes. Deliberately not the same question as "what can I edit":
 *  ownership transfers, so a launch can appear here with no edit panel, and
 *  an asset acquired rather than created is editable from its own page
 *  without ever appearing here. */
export function LaunchesTab({ address }: { address: string }) {
  const { data: launches, isLoading } = useSWR(
    ["my-launches", address],
    () => fetchLaunchesBySource(address),
    { refreshInterval: 30_000 },
  );

  // A launch you just broadcast exists nowhere else yet — not in the indexer,
  // not in the fairminters list — so without this it would simply vanish for
  // the ten-odd minutes until it confirms, which is exactly when you're most
  // likely to be looking at it. Same mempool fallback the asset page uses.
  const { data: pending } = useSWR(
    ["my-mempool-launches", address],
    async () => {
      const all = await fetchMempoolFairminters();
      return all.filter((fm) => fm.source === address);
    },
    { refreshInterval: 15_000 },
  );

  const confirmed = new Set((launches ?? []).map((l) => l.asset));
  const unconfirmed = (pending ?? []).filter((fm) => !confirmed.has(fm.asset));

  return (
    <div className="space-y-4">
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {unconfirmed.map((fm) => (
        <div
          key={fm.tx_hash}
          className="flex gap-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4"
        >
          <TokenImage asset={fm.asset} className="size-16 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-semibold text-gray-900">{fm.asset}</span>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                In mempool
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Broadcast, waiting to confirm. Its page and editing open up once
              it lands in a block.
            </p>
          </div>
        </div>
      ))}
      {launches !== null && launches !== undefined && launches.length === 0 && unconfirmed.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          This wallet hasn&apos;t launched anything yet.
        </p>
      )}
      {launches === null && (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Couldn&apos;t reach the launch index — try again shortly.
        </p>
      )}
      {launches?.map((launch) => (
        <LaunchCard key={launch.txHash} launch={launch} />
      ))}
    </div>
  );
}
