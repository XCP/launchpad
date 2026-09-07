"use client";

import { LazyLink } from "@/components/lazy-link";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { fetchAssetBalance, fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchEventsBySource, fetchMintsBySource, fetchSearchIndex } from "@/lib/api/launchpad-api";
import { computeActivity, reconcileActivity, type ActivityKind } from "@/lib/activity";
import { blocksEta, fromSats, tokenQty } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { msg } from "@/lib/i18n/t";

const LABEL: Record<ActivityKind, string> = {
  mint: msg("Minted"),
  mint_pending: msg("Mint open"),
  refund: msg("Refunded"),
  buy: msg("Bought"),
  sell: msg("Sold"),
  movement_in: msg("Other in"),
  movement_out: msg("Other out"),
};

const TONE: Record<ActivityKind, string> = {
  mint: "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300",
  mint_pending: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400",
  refund: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  buy: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400",
  sell: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400",
  movement_in: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
  movement_out: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
};

/** Blocks land about every ten minutes, so distance from the tip is a decent
 *  age — an estimate, and labelled as one. */
export function ActivityTab({ address }: { address: string }) {
  const num = useNumbers();
  const t = useT();
  const { data, isLoading } = useSWR(
    ["activity", address],
    async () => {
      const [launches, events, mints, height] = await Promise.all([
        fetchSearchIndex(),
        fetchEventsBySource(address),
        fetchMintsBySource(address),
        fetchBlockHeight(),
      ]);
      // Every conforming launch, not just graduated ones: a mint that is still
      // open is activity, and so is a refund from one that failed.
      const universe = new Map((launches ?? []).map((l) => [l.asset, true]));
      const focused = computeActivity(events ?? [], mints ?? [], universe);
      const assets = [...new Set(focused.map((row) => row.asset))];
      const balances = new Map(
        await Promise.all(
          assets.map(async (asset) => [asset, await fetchAssetBalance(address, asset)] as const),
        ),
      );
      return { rows: reconcileActivity(focused, balances), height };
    },
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );

  if (isLoading) return <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">{t("Loading activity…")}</p>;

  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {t("No mints, trades, or transfers on xcp.fun launches yet.")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Same table grammar as the holders list: fixed columns under their own
          headings, so the token names line up instead of being pushed around
          by however wide each status label happens to be. */}
      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_5rem] gap-x-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <span>{t("Token")}</span>
            <span>{t("Type")}</span>
            <span className="text-right">{t("Amount")}</span>
            <span className="text-right">XCP</span>
            <span className="text-right">{t("When")}</span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => {
              const tokensIn = r.tokenDelta >= 0n;
              const tokens = tokenQty((tokensIn ? r.tokenDelta : -r.tokenDelta).toString(), r.divisible);
              const xcpOut = r.xcpDelta < 0n;
              const xcp = fromSats((xcpOut ? -r.xcpDelta : r.xcpDelta).toString());
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_5rem] items-center gap-x-4 py-2.5 text-sm"
                >
                  <LazyLink href={`/${r.asset}`} className="flex min-w-0 items-center gap-2 hover:text-purple-600 dark:hover:text-purple-400">
                    <TokenImage asset={r.asset} className="size-6 shrink-0 rounded" />
                    <span className="truncate font-medium">{r.asset}</span>
                  </LazyLink>
                  <span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.kind]}`}>
                      {t(LABEL[r.kind])}
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                    {/* A refund moves XCP and no tokens; "+0" is noise. */}
                    {r.tokenDelta === 0n ? (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    ) : (
                      <>
                        {tokensIn ? "+" : "−"}
                        {num.compact(tokens)}
                      </>
                    )}
                  </span>
                  <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                    {r.xcpDelta === 0n ? (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    ) : (
                      <>
                        {xcpOut ? "−" : "+"}
                        {num.compact(xcp)}
                      </>
                    )}
                  </span>
                  <span className="text-right text-xs text-gray-400 dark:text-gray-500">
                    {r.block === null
                      ? t("other")
                      : data?.height
                        ? t("{age} ago", { age: blocksEta(Math.max(1, data.height - r.block), t) })
                        : t("block {n}", { n: r.block })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("Mints, refunds, and pool or order-book fills on XCP-69 launches. “Other” reconciles those events to the live balance and can represent a send, receive, burn, or liquidity movement. An open mint shows what you've committed — that XCP is escrowed by consensus and comes back automatically if the launch misses its soft cap.")}
      </p>
    </div>
  );
}
