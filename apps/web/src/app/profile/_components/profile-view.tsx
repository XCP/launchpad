"use client";

import { useState } from "react";
import useSWR from "swr";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { RewardsCard } from "@/app/profile/_components/rewards-card";
import { ConnectButton } from "@/components/connect-button";
import { Identicon } from "@/app/[asset]/_components/launch-view";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet/wallet-context";
import { ActivityTab } from "@/app/profile/_components/activity-tab";
import { HistoryTab } from "@/app/profile/_components/history-tab";
import { LaunchesTab } from "@/app/profile/_components/launches-tab";
import { MintingTab } from "@/app/profile/_components/minting-tab";
import { PositionsTab } from "@/app/profile/_components/positions-tab";
import { RewardsTab } from "@/app/profile/_components/rewards-tab";
import { fetchRewardAccount } from "@/lib/api/launchpad-api";

type Tab = "positions" | "history" | "activity" | "rewards" | "minting" | "launches";

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "history", label: "Closed" },
  { id: "activity", label: "Activity" },
  { id: "minting", label: "Minting" },
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

  const address = viewing ?? connectedAddress;
  const isSelf = !viewing || viewing === connectedAddress;
  const { data: rewardAccount } = useSWR(
    address ? ["reward-account", address] : null,
    () => fetchRewardAccount(address!),
    { revalidateOnFocus: false },
  );
  // A profile does not get an empty tab for an accrued promise. Reward
  // history exists only once this address has a real transaction to inspect.
  const tabs = rewardAccount?.hasRewardTx
    ? [
        ...BASE_TABS.slice(0, 3),
        { id: "rewards" as const, label: "Rewards" },
        ...BASE_TABS.slice(3),
      ]
    : BASE_TABS;

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

      <RewardsCard
        account={rewardAccount ?? null}
        isSelf={isSelf}
        onOpenHistory={rewardAccount?.hasRewardTx ? () => setTab("rewards") : undefined}
      />

      <div className="rounded-2xl border border-gray-200 bg-white">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <div className="border-b border-gray-200 p-2">
            <SegmentedList
              variant="card"
              className="!flex-nowrap overflow-x-auto text-xs sm:text-sm [&_[role=tab]]:!px-2"
            >
              {tabs.map((t) => (
                <SegmentedTrigger key={t.id} value={t.id} variant="card" grow={false}>
                  {t.label}
                </SegmentedTrigger>
              ))}
            </SegmentedList>
          </div>
        </Tabs>
        <div className="p-4">
          {tab === "positions" && <PositionsTab address={address} />}
          {tab === "history" && <HistoryTab address={address} />}
          {tab === "activity" && <ActivityTab address={address} />}
          {tab === "rewards" && rewardAccount?.hasRewardTx && (
            <RewardsTab account={rewardAccount} />
          )}
          {tab === "minting" && <MintingTab address={address} />}
          {tab === "launches" && <LaunchesTab address={address} />}
        </div>
      </div>
    </div>
  );
}
