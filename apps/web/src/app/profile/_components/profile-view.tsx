"use client";

import { useState } from "react";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { RewardsCard } from "@/app/profile/_components/rewards-card";
import { ConnectButton } from "@/components/connect-button";
import { Identicon } from "@/app/[asset]/_components/launch-view";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet/wallet-context";
import { PREVIEW_ADDRESS } from "@/lib/constants";
import { ActivityTab } from "@/app/profile/_components/activity-tab";
import { demoActivity, demoPortfolio } from "@/app/profile/_lib/demo-data";
import { HistoryTab } from "@/app/profile/_components/history-tab";
import { LaunchesTab } from "@/app/profile/_components/launches-tab";
import { PositionsTab } from "@/app/profile/_components/positions-tab";

type Tab = "positions" | "history" | "activity" | "launches";

/** Any height works for the preview: rows are placed relative to it, and the
 *  ages shown are derived from that distance. */
const BLOCK_TIP = 962_000;

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "history", label: "History" },
  { id: "activity", label: "Activity" },
  { id: "launches", label: "Launches" },
];

/**
 * One screen for two jobs. With `viewing` set it's a public profile for any
 * address — all of this is on-chain and needs no wallet. Without it, it's
 * your own, which is the only case that offers Disconnect.
 *
 * The edit panels inside the Launches tab don't need a self/other flag: they
 * already gate on the connected wallet matching the asset's live owner, so
 * looking at someone else's profile shows edit controls only for assets you
 * genuinely own — which is the correct answer, not a special case.
 */
export function ProfileView({ viewing }: { viewing?: string }) {
  const { status, address: connectedAddress, proofStatus, disconnect } = useWallet();
  const [tab, setTab] = useState<Tab>("positions");
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);

  const address = viewing ?? connectedAddress;
  const isSelf = !viewing || viewing === connectedAddress;

  // Same device as the asset pages' phase preview: nothing has graduated yet,
  // so these tabs are all empty and their design can't otherwise be seen.
  const portfolio = preview ? demoPortfolio() : undefined;
  const activity = preview ? demoActivity(BLOCK_TIP) : undefined;

  if (!address || (!viewing && status !== "connected")) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
        <p className="mb-4 text-sm text-gray-500">
          Connect your wallet to see your positions and launches.
        </p>
        <ConnectButton size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Identicon address={address} />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-semibold text-gray-900">
                {shortAddress(address)}
              </p>
              <p className="text-xs text-gray-500">
                {isSelf ? "Your xcp.fun profile" : "xcp.fun profile"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(address).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                  () => {},
                );
              }}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-300"
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <a
              href={`https://xcp.io/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-300"
            >
              Explorer ↗
            </a>
            {isSelf && (
              <button
                type="button"
                onClick={() => disconnect()}
                className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-red-600 hover:border-red-300"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {isSelf && proofStatus === "failed" && (
        <p className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
          Your wallet supplied a connection signature that didn&apos;t verify, so
          editing is locked for this session. Disconnect and reconnect to try
          again.
        </p>
      )}

      <RewardsCard address={address} isSelf={isSelf} />

      <div className="rounded-2xl border border-gray-200 bg-white">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <div className="border-b border-gray-200 p-2">
            <SegmentedList variant="card">
              {TABS.map((t) => (
                <SegmentedTrigger key={t.id} value={t.id} variant="card" grow={false}>
                  {t.label}
                </SegmentedTrigger>
              ))}
            </SegmentedList>
          </div>
        </Tabs>
        <div className="p-4">
          {tab === "positions" && <PositionsTab address={address} demo={portfolio} />}
          {tab === "history" && <HistoryTab address={address} demo={portfolio} />}
          {tab === "activity" && <ActivityTab address={address} demo={activity} />}
          {tab === "launches" && <LaunchesTab address={address} />}
        </div>
      </div>

      {connectedAddress === PREVIEW_ADDRESS && (
      <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-gray-200 bg-white/95 px-1.5 py-1 text-[11px] font-medium shadow-lg backdrop-blur">
        <span className="px-1.5 text-gray-400">preview</span>
        <button
          type="button"
          onClick={() => setPreview(false)}
          className={`rounded-full px-2 py-1 ${
            !preview ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          live
        </button>
        <button
          type="button"
          onClick={() => setPreview(true)}
          className={`rounded-full px-2 py-1 ${
            preview ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          sample data
        </button>
      </div>
      )}
    </div>
  );
}
