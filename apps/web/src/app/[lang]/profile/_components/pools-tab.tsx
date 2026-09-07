"use client";

import { LazyLink } from "@/components/lazy-link";
import { useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import {
  fetchPoolWithdrawQuote,
  type AddressPoolPosition,
} from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import { fromSats, tokenQty } from "@/lib/format";
import { useFiat, useFxRate } from "@/lib/currency";
import { big, ratio } from "@/lib/numeric";
import { useT } from "@/lib/i18n/client";
import { type Numbers, useNumbers } from "@/lib/i18n/numbers";

type Denom = "usd" | "xcp";

interface PoolPosition {
  assetA: string;
  assetB: string;
  primaryAsset: string;
  lpAsset: string;
  amountA: bigint | null;
  amountB: bigint | null;
  divisibleA: boolean;
  divisibleB: boolean;
  valueXcpSats: bigint | null;
  poolSharePct: number | null;
}

function holding(n: number, num: Numbers): string {
  if (n > 0 && n < 1) {
    return n.toLocaleString(num.intl, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return n.toLocaleString(num.intl, { maximumFractionDigits: 0 });
}

async function loadPosition(
  row: AddressPoolPosition,
  xcp69Assets: Set<string>,
): Promise<PoolPosition> {
  const primaryAsset = xcp69Assets.has(row.asset_a) ? row.asset_a : row.asset_b;
  const base = {
    assetA: row.asset_a,
    assetB: row.asset_b,
    primaryAsset,
    lpAsset: row.lp_asset,
    divisibleA: row.asset_a === "XCP" || row.asset_a_info?.divisible !== false,
    divisibleB: row.asset_b === "XCP" || row.asset_b_info?.divisible !== false,
  };
  try {
    const quote = await fetchPoolWithdrawQuote(row.asset_a, row.asset_b, row.quantity);
    const supply = big(quote.supply);
    if (!quote.pool_exists || supply <= 0n) throw new Error("pool quote unavailable");
    const amountA = big(
      quote.asset_a === row.asset_a ? quote.quantity_a_estimate : quote.quantity_b_estimate,
    );
    const amountB = big(
      quote.asset_b === row.asset_b ? quote.quantity_b_estimate : quote.quantity_a_estimate,
    );
    const xcpAmount =
      row.asset_a === "XCP" ? amountA : row.asset_b === "XCP" ? amountB : null;
    return {
      ...base,
      amountA,
      amountB,
      // The two reserve legs have equal value at the current pool price.
      valueXcpSats: xcpAmount === null ? null : xcpAmount * 2n,
      poolSharePct: ratio(row.quantity, supply) * 100,
    };
  } catch {
    return {
      ...base,
      amountA: null,
      amountB: null,
      valueXcpSats: null,
      poolSharePct: null,
    };
  }
}

/** Current LP-token holdings, expressed as the pool assets they represent. */
export function PoolsTab({
  address,
  pools,
  xcp69Assets,
}: {
  address: string;
  pools: AddressPoolPosition[];
  xcp69Assets: Set<string>;
}) {
  const t = useT();
  const num = useNumbers();
  const usd = useFiat();
  const { code } = useFxRate();
  const [denom, setDenom] = useState<Denom>("usd");
  const { data: xcpUsd } = useSWR("xcp-usd", fetchXcpUsd, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const { data: positions, isLoading } = useSWR(
    [
      "pool-position-details",
      address,
      pools
        .map(
          (pool) =>
            `${pool.lp_asset}:${String(pool.quantity)}:${xcp69Assets.has(pool.asset_a) ? pool.asset_a : pool.asset_b}`,
        )
        .join(","),
    ],
    () => Promise.all(pools.map((pool) => loadPosition(pool, xcp69Assets))),
    // Pool state changes only on a block. There is no reason to requote it
    // faster than the rest of the profile.
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );

  if (isLoading || !positions) {
    return (
      <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
        {t("Loading pools…")}
      </p>
    );
  }

  const showing: Denom = xcpUsd ? denom : "xcp";
  const money = (sats: bigint): string => {
    const xcp = fromSats(sats);
    if (showing === "usd" && xcpUsd) return usd(xcp * xcpUsd);
    return `${xcp.toLocaleString(num.intl, { maximumFractionDigits: 2 })} XCP`;
  };
  const total = positions.reduce((sum, position) => sum + (position.valueXcpSats ?? 0n), 0n);
  const hasKnownValue = positions.some((position) => position.valueXcpSats !== null);
  const incomplete = positions.some((position) => position.valueXcpSats === null);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {hasKnownValue ? (incomplete ? t("Known LP value") : t("LP value")) : t("LP positions")}
          </p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
            {hasKnownValue ? money(total) : num.commas(positions.length)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {hasKnownValue
              ? positions.length === 1
                ? t("Across {n} pool", { n: positions.length })
                : t("Across {n} pools", { n: positions.length })
              : positions.length === 1
                ? t("In {n} pool", { n: positions.length })
                : t("In {n} pools", { n: positions.length })}
          </p>
        </div>
        {xcpUsd && hasKnownValue && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-gray-200 p-0.5 text-xs font-medium dark:border-gray-800">
            {(["usd", "xcp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDenom(value)}
                aria-pressed={showing === value}
                className={`rounded-full px-2.5 py-1 ${
                  showing === value
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                }`}
              >
                {value === "usd" ? code : "XCP"}
              </button>
            ))}
          </div>
        )}
      </div>

      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {positions.map((position) => (
          <li
            key={position.lpAsset}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm"
          >
            <div className="min-w-0">
              <LazyLink
                href={`/${position.primaryAsset}`}
                className="flex min-w-0 items-center gap-2 hover:text-purple-600 dark:hover:text-purple-400"
              >
                <TokenImage asset={position.primaryAsset} className="size-7 shrink-0 rounded" />
                <span className="truncate font-medium">
                  {position.assetA}/{position.assetB}
                </span>
              </LazyLink>
              <p className="mt-1 truncate pl-9 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {position.amountA !== null && position.amountB !== null
                  ? `${holding(tokenQty(position.amountA, position.divisibleA), num)} ${position.assetA} + ${holding(tokenQty(position.amountB, position.divisibleB), num)} ${position.assetB}`
                  : t("Underlying amounts unavailable")}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular-nums text-gray-900 dark:text-gray-100">
                {position.valueXcpSats !== null ? money(position.valueXcpSats) : "—"}
              </p>
              <p className="mt-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {position.poolSharePct === null
                  ? t("Share unavailable")
                  : position.poolSharePct >= 0.01
                    ? t("{pct}% of pool", {
                        pct: position.poolSharePct.toLocaleString(num.intl, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }),
                      })
                    : t("<0.01% of pool")}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("Value and underlying amounts are what withdrawing the LP tokens now would return. XCP value is available when XCP is one side of the pair. LP profit and loss is not estimated.")}
      </p>
    </div>
  );
}
