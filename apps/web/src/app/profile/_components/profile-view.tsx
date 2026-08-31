"use client";

import { useMemo, useState } from "react";
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
import { OrdersTab } from "@/app/profile/_components/orders-tab";
import { PositionsTab } from "@/app/profile/_components/positions-tab";
import { PoolsTab } from "@/app/profile/_components/pools-tab";
import { RewardsTab } from "@/app/profile/_components/rewards-tab";
import { fetchAddressPoolPositions } from "@/lib/api/counterparty";
import { fetchRewardAccount, fetchSearchIndex } from "@/lib/api/launchpad-api";

type Tab = "positions" | "pools" | "orders" | "history" | "activity" | "rewards" | "minting" | "launches";

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  // Open orders sit between what you hold and what you have closed, because
  // that is what they are: a position you have committed to but not yet taken.
  { id: "orders", label: "Orders" },
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
  const { data: poolRows } = useSWR(
    address ? ["address-pools", address] : null,
    () => fetchAddressPoolPositions(address!),
    // One address-scoped read, block-paced. This discovers the tab without
    // checking every launch LP asset or touching the launchpad Worker/D1.
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );
  const { data: launchRows } = useSWR(
    poolRows && poolRows.length > 0 ? "xcp69-pool-membership" : null,
    fetchSearchIndex,
    // The launch index is edge-cached and shared by every pool on the profile.
    // Fetch it only for wallets that actually own LP tokens; this replaces a
    // per-pool launch lookup and keeps the membership test to one request.
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );
  const xcp69Assets = useMemo(
    () => new Set((launchRows ?? []).map((launch) => launch.asset)),
    [launchRows],
  );
  const pools = (poolRows ?? []).filter(
    (pool) => xcp69Assets.has(pool.asset_a) || xcp69Assets.has(pool.asset_b),
  );
  const hasPools = pools.length > 0;
  const poolClassificationReady =
    poolRows !== undefined && (poolRows.length === 0 || launchRows !== undefined);
  // If the last LP tokens are withdrawn while this tab is selected, render a
  // tab that still exists instead of leaving an empty panel selected.
  const activeTab: Tab =
    tab === "pools" && poolClassificationReady && !hasPools ? "positions" : tab;

  // A profile does not get an empty tab for an accrued promise. Reward
  // history exists only once this address has a real transaction to inspect.
  const tabs = (() => {
    const visible = [...BASE_TABS];
    if (hasPools) {
      visible.splice(1, 0, { id: "pools", label: "Pools" });
    }
    if (rewardAccount?.hasRewardTx) {
        // Anchored to the tab it follows, not to an index: the previous
        // slice(0, 3) silently moved Rewards the moment a tab was inserted
        // above it.
      const after = visible.findIndex((item) => item.id === "activity") + 1;
      visible.splice(after, 0, { id: "rewards", label: "Rewards" });
    }
    return visible;
  })();

  if (!address || (!viewing && status !== "connected")) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Connect your wallet to see your positions and launches.
        </p>
        <ConnectButton size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Identicon address={address} />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                {shortAddress(address)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
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
              className="rounded-full border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <a
              href={`https://xcp.io/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            >
              Explorer ↗
            </a>
            {isSelf && (
              <button
                type="button"
                onClick={() => disconnect()}
                className="rounded-full border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:border-red-300 dark:hover:border-red-700"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {isSelf && proofStatus === "failed" && (
        <p className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-2.5 text-xs text-red-800 dark:text-red-300">
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

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as Tab)}>
          <div className="border-b border-gray-200 dark:border-gray-800 p-2">
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
          {activeTab === "positions" && <PositionsTab address={address} />}
          {activeTab === "pools" && (
            <PoolsTab address={address} pools={pools} xcp69Assets={xcp69Assets} />
          )}
          {activeTab === "orders" && <OrdersTab address={address} canCancel={!viewing} />}
          {activeTab === "history" && <HistoryTab address={address} />}
          {activeTab === "activity" && <ActivityTab address={address} />}
          {activeTab === "rewards" && rewardAccount?.hasRewardTx && (
            <RewardsTab account={rewardAccount} />
          )}
          {activeTab === "minting" && <MintingTab address={address} />}
          {activeTab === "launches" && <LaunchesTab address={address} />}
        </div>
      </div>
    </div>
  );
}
