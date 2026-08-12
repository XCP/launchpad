"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { AssetChip } from "@/components/asset-chip";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Well } from "@/components/ui/well";
import { fetchFairmintersByAsset } from "@/lib/api/counterparty";
import { fetchBalance, fetchJson } from "@/lib/client";
import { commas, commasRaw, usd as usdFmt } from "@/lib/format";
import { approx, big } from "@/lib/numeric";
import { trackTx } from "@/lib/analytics";
import { registerPending } from "@/lib/pending";
import { isBusy } from "@/hooks/use-busy";
import { fetchMedianFeeRate, useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { saleTarget, xcp69Params, XCP69 } from "@/lib/xcp69";

const SATS = 1e8;
const MINT_VBYTES = 250;
const TOKENS_PER_LOT = XCP69.QUANTITY_BY_PRICE / SATS; // 1,000
const MAX_LOTS = XCP69.MAX_MINT_PER_ADDRESS / XCP69.QUANTITY_BY_PRICE; // 1,000
const XCP_PER_LOT = XCP69.PRICE / SATS; // 0.01
const SUPPLY_TOKENS = 100_000_000;
/** Token presets; 1M = the 10 XCP max mint. */
const PRESETS = [10_000, 100_000, 1_000_000];

/** Fixed-lot mint in the house grammar: receive/pay wells, an always-open
 *  receipt whose signature row is the refund guarantee, inline success. */
export function MintPanel({
  asset,
  xcpUsd = null,
}: {
  asset: string;
  xcpUsd?: number | null;
}) {
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const [tokens, setTokens] = useState("10000");

  // How many lots are actually left to mint — core rejects a fairmint whose
  // quantity would push the asset past hard_cap outright (no partial fill
  // for priced fairminters), so a stale or missing read just means no extra
  // clamp is applied rather than a false one.
  const { data: remainingLots } = useSWR(
    ["mint-remaining", asset],
    async () => {
      const fairminters = await fetchFairmintersByAsset(asset);
      const fm = fairminters.find((f) => xcp69Params(f));
      if (!fm) return null;
      const remaining = big(saleTarget(fm)) - big(fm.earned_quantity ?? 0);
      const remainingRaw = remaining > 0n ? remaining : 0n;
      return Math.floor(approx(remainingRaw) / XCP69.QUANTITY_BY_PRICE);
    },
    { refreshInterval: 20_000, revalidateOnFocus: false },
  );
  const maxLots =
    remainingLots !== undefined && remainingLots !== null
      ? Math.min(MAX_LOTS, remainingLots)
      : MAX_LOTS;

  const typedTokens = parseFloat(tokens) || 0;
  const lots = Math.max(0, Math.min(maxLots, Math.floor(typedTokens / TOKENS_PER_LOT)));
  const mintTokens = lots * TOKENS_PER_LOT;
  const adjusted = typedTokens > 0 && mintTokens !== typedTokens;
  const costXcp = lots * XCP_PER_LOT;
  const costRaw = lots * XCP69.PRICE;

  const { data: xcpBalance } = useSWR(
    address ? [address, "XCP", "mint-xcp-balance"] : null,
    ([addr]) => fetchBalance(addr, "XCP"),
    { refreshInterval: 30_000 },
  );
  const insufficient =
    xcpBalance !== undefined && costRaw > 0 && costRaw > approx(xcpBalance);

  const { data: medianFeeRate } = useSWR("btc-feerate", fetchMedianFeeRate, {
    refreshInterval: 30_000,
  });
  const { data: btcUsd } = useSWR(
    "btc-usd",
    () =>
      fetchJson("https://mempool.space/api/v1/prices").then(
        (d: { USD: number }) => d.USD,
      ),
    { refreshInterval: 60_000 },
  );

  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "confirmed") {
      registerPending({
        txid: compose.txid,
        kind: "mint",
        label: `Mint ${mintTokens.toLocaleString()} ${asset}`,
        address: address ?? undefined,
      });
      // The XCP escrowed, valued at the rate the panel just quoted.
      trackTx(compose.txid, "mint", xcpUsd ? costXcp * xcpUsd : null);
    }
  }, [compose.status, compose.txid, mintTokens, asset, address, costXcp, xcpUsd]);

  const ready = lots > 0 && !busy && !insufficient;
  const buttonLabel = busy
    ? compose.status === "composing"
      ? "Composing…"
      : compose.status === "signing"
        ? "Confirm in wallet…"
        : "Broadcasting…"
    : lots === 0
      ? "Enter an amount"
      : insufficient
        ? "Insufficient XCP balance"
        : `Mint ${commas(mintTokens)} ${asset}`;

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* You receive — tokens, in whole lots */}
      <Well
        focusable
        label="You mint"
        topRight={
          <span className="flex items-center gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTokens(String(p))}
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors active:scale-95 ${
                  mintTokens === p && typedTokens > 0
                    ? "border-purple-400 bg-white text-purple-600"
                    : "border-gray-200 bg-white text-gray-500 hover:border-purple-400 hover:text-purple-600"
                }`}
              >
                {p === 1_000_000 ? "Max" : `${p / 1000}k`}
              </button>
            ))}
          </span>
        }
        chip={<AssetChip asset={asset} />}
        footer={
          <>
            <span>
              ≈ {usdFmt(xcpUsd && costXcp > 0 ? costXcp * xcpUsd : 0)}
              {adjusted && lots > 0 && (
                <span className="text-amber-600">
                  {" "}
                  · adjusts to {commas(mintTokens)}
                </span>
              )}
            </span>
            <span>
              {((mintTokens / SUPPLY_TOKENS) * 100).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              })}
              % of supply
            </span>
          </>
        }
      >
        {/* Integer-only, so the input can carry real digit grouping —
            unlike decimal AmountInputs, where a comma means a decimal point. */}
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={typedTokens > 0 ? typedTokens.toLocaleString("en-US") : tokens}
          onChange={(e) => setTokens(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="0"
          aria-label={`${asset} to mint`}
          className="w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight text-gray-900 outline-none placeholder:text-gray-300"
        />
      </Well>

      {/* You pay — XCP, escrowed by consensus */}
      <div className="mt-1">
        <Well
          label="You pay"
          topRight={<span>escrowed until launch</span>}
          chip={<AssetChip asset="XCP" />}
          footer={
            <>
              <span>≈ {usdFmt(xcpUsd && costXcp > 0 ? costXcp * xcpUsd : 0)}</span>
              {xcpBalance !== undefined && (
                <button
                  type="button"
                  className={`min-w-0 truncate hover:text-purple-600 ${
                    insufficient ? "text-red-600" : "text-gray-500"
                  }`}
                  onClick={() =>
                    setTokens(
                      String(
                        Math.min(
                          maxLots,
                          Math.floor(approx(xcpBalance) / XCP69.PRICE),
                        ) * TOKENS_PER_LOT,
                      ),
                    )
                  }
                >
                  Balance: {commasRaw(xcpBalance)}
                </button>
              )}
            </>
          }
        >
          <div
            className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
              costXcp > 0
                ? insufficient
                  ? "text-red-600"
                  : "text-gray-900"
                : "text-gray-300"
            }`}
          >
            {costXcp > 0 ? costXcp.toFixed(2) : "0"}
          </div>
        </Well>
      </div>

      {/* Receipt — the refund guarantee is the signature row */}
      {lots > 0 && (
        <div className="px-2 pt-2">
          <dl className="space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <dt title="Escrowed by the protocol, not sent to the creator">
                If it fails to launch
              </dt>
              <dd className="font-medium text-gray-700">
                full XCP refund, automatic
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Lots</dt>
              <dd>
                {lots.toLocaleString()} × {commas(TOKENS_PER_LOT)} tokens
              </dd>
            </div>
            {medianFeeRate !== undefined && (
              <div className="flex justify-between">
                <dt>TX fee</dt>
                <dd>
                  {medianFeeRate} sat/vB
                  {btcUsd !== undefined && (
                    <span className="text-gray-500">
                      {" "}
                      (~{usdFmt(((medianFeeRate * MINT_VBYTES) / SATS) * btcUsd)})
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="px-0.5 pb-0.5 pt-3">
        {compose.status === "error" && (
          <ErrorBanner className="mb-2" onDismiss={compose.reset}>{compose.error}</ErrorBanner>
        )}
        {walletStatus !== "connected" ? (
          <ConnectButton />
        ) : (
          <CTA
            disabled={!ready}
            onClick={() =>
              compose.composeFairmint({
                asset,
                quantity: lots * XCP69.QUANTITY_BY_PRICE,
              })
            }
          >
            {buttonLabel}
          </CTA>
        )}
        {insufficient && (
          <p className="mt-2 text-center text-[11px] text-gray-500">
            Need XCP?{" "}
            <Link href="/dispense" className="text-purple-600 underline">
              Buy some with BTC
            </Link>
            .
          </p>
        )}
        {compose.status === "confirmed" && (
          <div className="mt-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800">
                Mint broadcast — <TxLink txid={compose.txid} />
              </span>
              <button
                type="button"
                onClick={compose.reset}
                className="text-xs text-green-800 underline"
              >
                Dismiss
              </button>
            </div>
            <p className="mt-1 text-xs text-green-700">
              Escrowed until the launch resolves: tokens if it sells out, full
              XCP refund if it doesn&apos;t.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
