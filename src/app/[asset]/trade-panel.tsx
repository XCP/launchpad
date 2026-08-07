"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { AssetChip } from "@/components/asset-chip";
import { ConnectButton } from "@/components/connect-button";
import { OrderTracker } from "@/components/order-tracker";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Well } from "@/components/ui/well";
import { commas, price as formatPrice, usd as usdFmt } from "@/lib/format";
import { registerPending } from "@/lib/pending";
import { isBusy } from "@/lib/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchBalance, fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { useSwapSettings } from "@/app/swap/swap-settings";

/**
 * The limit panel, built on the one primitive Counterparty has: the DEX
 * order at YOUR price. If it's priced through the pool it fills when it
 * confirms; otherwise it RESTS until a counter-order takes it — the pool
 * never auto-fills a resting order. Same grammar as the swap card:
 * Buy | Sell pill tabs, wells with corner labels, always-open receipt.
 */

const SATS = 1e8;
const ORDER_VBYTES = 250;
const LIMIT_EXPIRATIONS = [
  { blocks: 144, label: "~1 day" },
  { blocks: 1000, label: "~1 week" },
  { blocks: 5000, label: "~5 weeks" },
];
/** Price nudges off the pool spot: buyers bid under, sellers ask over. */
const PRICE_PRESETS = [1, 5, 10];
const fmtPriceInput = (x: number) => x.toFixed(8).replace(/\.?0+$/, "");
const fmtAmount = (n: number) => n.toFixed(8).replace(/\.?0+$/, "");

interface PoolInfo {
  asset_a: string;
  asset_b: string;
  reserve_a: number;
  reserve_b: number;
}

export function TradePanel({
  asset,
  xcpUsd = null,
}: {
  asset: string;
  xcpUsd?: number | null;
}) {
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState(""); // XCP per token
  const [limitAmount, setLimitAmount] = useState(""); // tokens
  const [expiration, setExpiration] = useState(1000);

  const { customFee, medianFeeRate } = useSwapSettings();
  const feeRate = customFee > 0 ? customFee : (medianFeeRate ?? null);
  const { data: btcUsd } = useSWR(
    "btc-usd",
    () =>
      fetchJson("https://mempool.space/api/v1/prices").then(
        (d: { USD: number }) => d.USD,
      ),
    { refreshInterval: 60_000 },
  );

  const { data: pool } = useSWR<PoolInfo | null>(
    `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP`,
    (url: string) => fetchJson(url).then((d) => d.result ?? null),
    { refreshInterval: 60_000 },
  );
  const spot = pool
    ? (pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b) /
      (pool.asset_a === asset ? pool.reserve_a : pool.reserve_b)
    : null;

  const { data: tokenBalance } = useSWR(
    address && asset ? [address, asset, "limit-token-balance"] : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );
  const { data: xcpBalance } = useSWR(
    address ? [address, "XCP", "limit-xcp-balance"] : null,
    ([addr]) => fetchBalance(addr, "XCP"),
    { refreshInterval: 30_000 },
  );

  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "confirmed") {
      registerPending({
        txid: compose.txid,
        kind: "order",
        label: `${side === "buy" ? "Buy" : "Sell"} ${asset} — limit order`,
        address: address ?? undefined,
      });
    }
  }, [compose.status, compose.txid, side, asset, address]);

  const limitPriceNum = parseFloat(limitPrice) || 0;
  const limitAmountRaw = Math.round((parseFloat(limitAmount) || 0) * SATS);
  const limitTotalRaw = Math.round(limitAmountRaw * limitPriceNum);
  // The give side must be covered: XCP for a buy, tokens for a sell.
  const giveBalance = side === "buy" ? xcpBalance : tokenBalance;
  const giveNeeded = side === "buy" ? limitTotalRaw : limitAmountRaw;
  const insufficient =
    giveBalance !== undefined && giveNeeded > 0 && giveNeeded > giveBalance;
  const limitReady =
    limitPriceNum > 0 &&
    limitAmountRaw > 0 &&
    limitTotalRaw > 0 &&
    !busy &&
    !insufficient;
  // Priced through the pool = fills at confirmation; otherwise it rests.
  const limitFillsNow =
    spot !== null && limitPriceNum > 0
      ? side === "buy"
        ? limitPriceNum >= spot
        : limitPriceNum <= spot
      : null;
  const priceDelta =
    spot !== null && spot > 0 && limitPriceNum > 0
      ? (limitPriceNum / spot - 1) * 100
      : null;
  // Max amount the give balance affords at this price.
  const maxAmountRaw =
    side === "sell"
      ? (tokenBalance ?? 0)
      : limitPriceNum > 0
        ? Math.floor((xcpBalance ?? 0) / limitPriceNum)
        : 0;

  const submitLimit = () => {
    if (!limitReady) return;
    compose.composeOrder(
      side === "buy"
        ? {
            give_asset: "XCP",
            give_quantity: limitTotalRaw,
            get_asset: asset,
            get_quantity: limitAmountRaw,
            expiration,
            fee_rate: customFee > 0 ? customFee : undefined,
          }
        : {
            give_asset: asset,
            give_quantity: limitAmountRaw,
            get_asset: "XCP",
            get_quantity: limitTotalRaw,
            expiration,
            fee_rate: customFee > 0 ? customFee : undefined,
          },
    );
  };

  const buttonLabel = busy
    ? compose.status === "composing"
      ? "Composing…"
      : compose.status === "signing"
        ? "Confirm in wallet…"
        : "Broadcasting…"
    : limitPriceNum === 0
      ? "Enter a price"
      : limitAmountRaw === 0
        ? "Enter an amount"
        : insufficient
          ? `Insufficient ${side === "buy" ? "XCP" : asset} balance`
          : `Place limit ${side}`;

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* Buy | Sell — same pill row as liquidity's Add | Remove */}
      <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-sm font-medium">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`flex-1 rounded-lg px-3 py-1.5 capitalize ${
              side === s
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Price well — presets nudge off the pool spot */}
      <div className="mt-2">
        <Well
          focusable
          label={`Price · XCP per ${asset}`}
          topRight={
            spot !== null ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setLimitPrice(fmtPriceInput(spot))}
                  className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                >
                  Market
                </button>
                {PRICE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setLimitPrice(
                        fmtPriceInput(
                          spot * (1 + (side === "buy" ? -p : p) / 100),
                        ),
                      )
                    }
                    className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                  >
                    {side === "buy" ? "−" : "+"}
                    {p}%
                  </button>
                ))}
              </span>
            ) : undefined
          }
          footer={
            <>
              <span>
                {priceDelta !== null && Math.abs(priceDelta) >= 0.1 ? (
                  <span
                    className={
                      limitFillsNow ? "text-green-700" : "text-gray-500"
                    }
                  >
                    {priceDelta > 0 ? "+" : ""}
                    {priceDelta.toFixed(1)}% vs pool
                  </span>
                ) : (
                  <span>&nbsp;</span>
                )}
              </span>
              {spot !== null && (
                <button
                  type="button"
                  className="text-gray-500 hover:text-purple-600"
                  onClick={() => setLimitPrice(fmtPriceInput(spot))}
                >
                  Pool: {formatPrice(spot)}
                </button>
              )}
            </>
          }
        >
          <AmountInput
            value={limitPrice}
            onChange={setLimitPrice}
            placeholder={spot ? formatPrice(spot) : "0"}
            ariaLabel={`Limit price in XCP per ${asset}`}
            className="w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight text-gray-900 outline-none placeholder:text-gray-300"
          />
        </Well>
      </div>

      {/* Amount well */}
      <div className="mt-1">
        <Well
          focusable
          label="Amount"
          topRight={
            maxAmountRaw > 0 ? (
              <span className="flex items-center gap-1">
                {([25, 50, 75, 100] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setLimitAmount(
                        fmtAmount(Math.floor((maxAmountRaw * p) / 100) / SATS),
                      )
                    }
                    className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                  >
                    {p === 100 ? "Max" : `${p}%`}
                  </button>
                ))}
              </span>
            ) : undefined
          }
          chip={<AssetChip asset={asset} />}
          footer={
            <>
              <span>
                ≈{" "}
                {usdFmt(
                  xcpUsd && limitTotalRaw > 0
                    ? (limitTotalRaw / SATS) * xcpUsd
                    : 0,
                )}
              </span>
              {giveBalance !== undefined && (
                <button
                  type="button"
                  className={`min-w-0 truncate hover:text-purple-600 ${
                    insufficient ? "text-red-600" : "text-gray-500"
                  }`}
                  onClick={() => {
                    if (maxAmountRaw > 0)
                      setLimitAmount(fmtAmount(maxAmountRaw / SATS));
                  }}
                >
                  Balance: {commas(giveBalance / SATS)}{" "}
                  {side === "buy" ? "XCP" : ""}
                </button>
              )}
            </>
          }
        >
          <AmountInput
            value={limitAmount}
            onChange={setLimitAmount}
            ariaLabel={`Amount of ${asset}`}
            className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
              insufficient ? "text-red-600" : "text-gray-900"
            }`}
          />
        </Well>
      </div>

      {/* Receipt — always open once price and amount exist */}
      {limitPriceNum > 0 && limitAmountRaw > 0 && (
        <div className="px-2 pt-2">
          <dl className="space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <dt>Total</dt>
              <dd className="font-medium tabular-nums text-gray-700">
                {commas(limitTotalRaw / SATS)} XCP
              </dd>
            </div>
            {spot !== null && (
              <div className="flex justify-between">
                <dt>Fills</dt>
                <dd
                  className={limitFillsNow ? "font-medium text-green-700" : ""}
                >
                  {limitFillsNow
                    ? "at confirmation — priced through the pool"
                    : "rests on the book until a counter-order takes it"}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt>Expires</dt>
              <dd>
                <select
                  value={expiration}
                  onChange={(e) => setExpiration(Number(e.target.value))}
                  className="rounded-lg border border-gray-200 px-1.5 py-0.5 text-xs"
                  aria-label="Order expiration"
                >
                  {LIMIT_EXPIRATIONS.map((x) => (
                    <option key={x.blocks} value={x.blocks}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            {feeRate !== null && (
              <div className="flex justify-between">
                <dt>TX fee</dt>
                <dd className={customFee > 0 ? "font-medium text-purple-600" : ""}>
                  {feeRate} sat/vB
                  {btcUsd !== undefined && (
                    <span className="text-gray-400">
                      {" "}
                      (~{usdFmt(((feeRate * ORDER_VBYTES) / SATS) * btcUsd)})
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
          <ErrorBanner className="mb-2">{compose.error}</ErrorBanner>
        )}
        {walletStatus !== "connected" ? (
          <ConnectButton />
        ) : (
          <CTA disabled={!limitReady} onClick={submitLimit}>
            {buttonLabel}
          </CTA>
        )}
        {compose.status === "confirmed" && (
          <div className="mt-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800">
                Order broadcast — <TxLink txid={compose.txid} />
              </span>
              <button
                type="button"
                onClick={compose.reset}
                className="text-xs text-green-800 underline"
              >
                Dismiss
              </button>
            </div>
            <OrderTracker
              txHash={compose.txid}
              busy={busy}
              onCancel={(hash) => compose.composeCancel({ offer_hash: hash })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
