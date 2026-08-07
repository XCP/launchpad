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
import { LIMIT_EXPIRATIONS, useSwapSettings } from "@/app/swap/swap-settings";

/**
 * The limit panel, built on the one primitive Counterparty has: the DEX
 * order at YOUR price. If it's priced through the pool it fills when it
 * confirms; otherwise it RESTS until a counter-order takes it — the pool
 * never auto-fills a resting order. Same grammar as the swap card:
 * Buy | Sell pill tabs, wells with corner labels, always-open receipt.
 */

const SATS = 1e8;
const ORDER_VBYTES = 250;
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

interface BookOrder {
  give_asset: string;
  give_remaining: number;
  get_remaining: number;
  /** XCP per token when giving the token (an ask). */
  give_price: number;
  /** XCP per token when giving XCP (a bid). */
  get_price: number;
}

export function TradePanel({
  asset,
  xcpUsd = null,
  onOpenSelector,
}: {
  asset: string;
  xcpUsd?: number | null;
  /** When set, the token chip opens the pair selector (multi-asset /swap). */
  onOpenSelector?: () => void;
}) {
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState(""); // XCP per token
  // Amount and Total are bidirectional (the liquidity-form pattern):
  // edit either and the other derives through the price.
  const [amountStr, setAmountStr] = useState(""); // tokens
  const [totalStr, setTotalStr] = useState(""); // XCP
  const [editField, setEditField] = useState<"amount" | "total">("amount");

  const { customFee, medianFeeRate, limitExpiration } = useSwapSettings();
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

  // The resting book: best counter-order beats the pool with no fee. One
  // page covers today's books; revisit pagination if depth ever grows.
  const { data: bookOrders } = useSWR<BookOrder[]>(
    `${COUNTERPARTY_API_BASE}/orders/${asset}/XCP?status=open&limit=1000`,
    (url: string) => fetchJson(url).then((d) => d.result ?? []),
    { refreshInterval: 60_000 },
  );
  const bestAsk = (bookOrders ?? [])
    .filter((o) => o.give_asset === asset && o.give_remaining > 0)
    .reduce<number | null>(
      (m, o) => (m === null || o.give_price < m ? o.give_price : m),
      null,
    );
  const bestBid = (bookOrders ?? [])
    .filter((o) => o.give_asset === "XCP" && o.give_remaining > 0)
    .reduce<number | null>(
      (m, o) => (m === null || o.get_price > m ? o.get_price : m),
      null,
    );

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
  const limitAmountRaw =
    editField === "amount"
      ? Math.round((parseFloat(amountStr) || 0) * SATS)
      : limitPriceNum > 0
        ? Math.round(((parseFloat(totalStr) || 0) * SATS) / limitPriceNum)
        : 0;
  const limitTotalRaw =
    editField === "total"
      ? Math.round((parseFloat(totalStr) || 0) * SATS)
      : Math.round(limitAmountRaw * limitPriceNum);
  // The give side must be covered: XCP (Total) for a buy, tokens for a sell.
  const insufficientToken =
    side === "sell" &&
    tokenBalance !== undefined &&
    limitAmountRaw > 0 &&
    limitAmountRaw > tokenBalance;
  const insufficientXcp =
    side === "buy" &&
    xcpBalance !== undefined &&
    limitTotalRaw > 0 &&
    limitTotalRaw > xcpBalance;
  const insufficient = insufficientToken || insufficientXcp;
  const limitReady =
    limitPriceNum > 0 &&
    limitAmountRaw > 0 &&
    limitTotalRaw > 0 &&
    !busy &&
    !insufficient;
  // Fill forecast vs the pool. The pool's 50 bps fee is charged in-curve,
  // so the executable marginal price starts ~0.5% worse than the reserve
  // midpoint: an order must be priced THROUGH the fee band to actually
  // take pool liquidity. Matching is bounded by your own limit, so a
  // crossing order fills until the curve reaches your price — any
  // remainder rests. (Resting book orders could also fill you; with
  // today's empty books the pool is the honest reference.)
  const POOL_FEE = 0.005;
  // The book matches fee-free, so a resting counter-order can fill you at
  // a price the pool can't. Book reference for this side:
  const bookRef = side === "buy" ? bestAsk : bestBid;
  const crossesBook =
    bookRef !== null &&
    limitPriceNum > 0 &&
    (side === "buy" ? limitPriceNum >= bookRef : limitPriceNum <= bookRef);
  const crossesPool =
    spot !== null &&
    limitPriceNum > 0 &&
    (side === "buy"
      ? limitPriceNum >= spot * (1 + POOL_FEE)
      : limitPriceNum <= spot * (1 - POOL_FEE));
  const inFeeBand =
    spot !== null &&
    limitPriceNum > 0 &&
    !crossesPool &&
    (side === "buy" ? limitPriceNum >= spot : limitPriceNum <= spot);
  const fillState: "crosses" | "feeband" | "rests" | null =
    limitPriceNum > 0 && (spot !== null || bookRef !== null)
      ? crossesPool || crossesBook
        ? "crosses"
        : inFeeBand
          ? "feeband"
          : "rests"
      : null;
  const limitFillsNow = fillState === "crosses";
  const priceDelta =
    spot !== null && spot > 0 && limitPriceNum > 0
      ? (limitPriceNum / spot - 1) * 100
      : null;

  const submitLimit = () => {
    if (!limitReady) return;
    compose.composeOrder(
      side === "buy"
        ? {
            give_asset: "XCP",
            give_quantity: limitTotalRaw,
            get_asset: asset,
            get_quantity: limitAmountRaw,
            expiration: limitExpiration,
            fee_rate: customFee > 0 ? customFee : undefined,
          }
        : {
            give_asset: asset,
            give_quantity: limitAmountRaw,
            get_asset: "XCP",
            get_quantity: limitTotalRaw,
            expiration: limitExpiration,
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
              <span className="flex items-center gap-2">
                {spot !== null && (
                  <button
                    type="button"
                    className="text-gray-500 hover:text-purple-600"
                    onClick={() => setLimitPrice(fmtPriceInput(spot))}
                  >
                    Pool: {formatPrice(spot)}
                  </button>
                )}
                {bookRef !== null && (
                  <button
                    type="button"
                    className="text-gray-500 hover:text-purple-600"
                    onClick={() => setLimitPrice(fmtPriceInput(bookRef))}
                  >
                    {side === "buy" ? "Ask" : "Bid"}: {formatPrice(bookRef)}
                  </button>
                )}
              </span>
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

      {/* Amount well — the token leg; the chip is the pair selector on /swap */}
      <div className="mt-1">
        <Well
          focusable
          label="Amount"
          topRight={
            side === "sell" && (tokenBalance ?? 0) > 0 ? (
              <span className="flex items-center gap-1">
                {([25, 50, 75, 100] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setEditField("amount");
                      setAmountStr(
                        fmtAmount(
                          Math.floor(((tokenBalance ?? 0) * p) / 100) / SATS,
                        ),
                      );
                    }}
                    className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                  >
                    {p === 100 ? "Max" : `${p}%`}
                  </button>
                ))}
              </span>
            ) : undefined
          }
          chip={<AssetChip asset={asset} onClick={onOpenSelector} />}
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
              {tokenBalance !== undefined && (
                <button
                  type="button"
                  className={`min-w-0 truncate hover:text-purple-600 ${
                    insufficientToken ? "text-red-600" : "text-gray-500"
                  }`}
                  onClick={() => {
                    setEditField("amount");
                    setAmountStr(fmtAmount(tokenBalance / SATS));
                  }}
                >
                  Balance: {commas(tokenBalance / SATS)}
                </button>
              )}
            </>
          }
        >
          <AmountInput
            value={
              editField === "amount"
                ? amountStr
                : limitAmountRaw > 0
                  ? fmtAmount(limitAmountRaw / SATS)
                  : ""
            }
            onChange={(v) => {
              setEditField("amount");
              setAmountStr(v);
            }}
            ariaLabel={`Amount of ${asset}`}
            className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
              insufficientToken ? "text-red-600" : "text-gray-900"
            }`}
          />
        </Well>
      </div>

      {/* Total well — the XCP leg, equally editable through the price */}
      <div className="mt-1">
        <Well
          focusable
          label="Total"
          topRight={
            side === "buy" && (xcpBalance ?? 0) > 0 ? (
              <span className="flex items-center gap-1">
                {([25, 50, 75, 100] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setEditField("total");
                      setTotalStr(
                        fmtAmount(
                          Math.floor(((xcpBalance ?? 0) * p) / 100) / SATS,
                        ),
                      );
                    }}
                    className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                  >
                    {p === 100 ? "Max" : `${p}%`}
                  </button>
                ))}
              </span>
            ) : undefined
          }
          chip={<AssetChip asset="XCP" />}
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
              {xcpBalance !== undefined && (
                <button
                  type="button"
                  className={`min-w-0 truncate hover:text-purple-600 ${
                    insufficientXcp ? "text-red-600" : "text-gray-500"
                  }`}
                  onClick={() => {
                    setEditField("total");
                    setTotalStr(fmtAmount(xcpBalance / SATS));
                  }}
                >
                  Balance: {commas(xcpBalance / SATS)}
                </button>
              )}
            </>
          }
        >
          <AmountInput
            value={
              editField === "total"
                ? totalStr
                : limitTotalRaw > 0
                  ? fmtAmount(limitTotalRaw / SATS)
                  : ""
            }
            onChange={(v) => {
              setEditField("total");
              setTotalStr(v);
            }}
            ariaLabel="Total in XCP"
            className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
              insufficientXcp ? "text-red-600" : "text-gray-900"
            }`}
          />
        </Well>
      </div>

      {/* Receipt — always open once price and amount exist */}
      {limitPriceNum > 0 && limitAmountRaw > 0 && (
        <div className="px-2 pt-2">
          <dl className="space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <dt
                title={`Enforced by the order itself — a better fill refunds the difference in ${
                  side === "buy" ? "XCP" : asset
                }`}
              >
                Min received
              </dt>
              <dd className="font-medium tabular-nums text-gray-700">
                {side === "buy"
                  ? `${(limitAmountRaw / SATS).toFixed(8)} ${asset}`
                  : `${(limitTotalRaw / SATS).toFixed(8)} XCP`}
              </dd>
            </div>
            {fillState !== null && (
              <div className="flex justify-between">
                <dt>Fills</dt>
                <dd
                  className={limitFillsNow ? "font-medium text-green-700" : ""}
                >
                  {fillState === "crosses"
                    ? crossesBook && !crossesPool
                      ? `at confirmation — crosses the book's best ${
                          side === "buy" ? "ask" : "bid"
                        }`
                      : "up to your price at confirmation — any remainder rests"
                    : fillState === "feeband"
                      ? "likely rests — inside the pool's 0.5% fee"
                      : "rests on the book until a counter-order takes it"}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Expires</dt>
              <dd>
                {LIMIT_EXPIRATIONS.find((x) => x.blocks === limitExpiration)
                  ?.label ?? `${limitExpiration} blocks`}
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
