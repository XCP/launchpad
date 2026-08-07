"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { OrderTracker } from "@/components/order-tracker";
import { ConfirmCard, TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { QuoteRing } from "@/components/quote-ring";
import { commas, price as formatPrice } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { registerPending } from "@/lib/pending";
import { isBusy } from "@/lib/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchBalance, fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Trading for graduated launches, built on the one primitive Counterparty
 * has: the DEX order. Matching runs once, when a NEW order confirms —
 * pool and book interleaved, best price first. So:
 *  - Market = an order at the quoted output minus slippage, expiring in one
 *    block: it fills at confirmation or the remainder refunds next block.
 *  - Limit  = the same message at your price. If it's priced through the
 *    pool it fills on confirmation; otherwise it RESTS until a counter-order
 *    takes it — the pool never auto-fills a resting order.

 */

const SATS = 1e8;
const MARKET_EXPIRATION = 1; // fills at confirmation, or refunds next block
const QUOTE_REFRESH_MS = 10_000;
const LIMIT_EXPIRATIONS = [
  { blocks: 144, label: "~1 day" },
  { blocks: 1000, label: "~1 week" },
  { blocks: 5000, label: "~5 weeks" },
];
const SLIPPAGES = [0.5, 1, 2];

interface Quote {
  estimated_output: number;
  pool_output: number;
  book_output: number;
  price_impact: number;
  fee_bps?: number;
  pool_exists: boolean;
}

interface PoolInfo {
  asset_a: string;
  asset_b: string;
  reserve_a: number;
  reserve_b: number;
}

export function TradePanel({
  asset,
  only,
}: {
  asset: string;
  /** Pin to one tab and drop the chrome — for embedding in AssetTradeSurface. */
  only?: "limit";
}) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [tab, setTab] = useState<"market" | "limit">(only ?? "market");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(""); // human units of the GIVE asset
  const [slippage, setSlippage] = useState(1);
  const [priceMoved, setPriceMoved] = useState(false);
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);
  const [limitPrice, setLimitPrice] = useState(""); // XCP per token
  const [limitAmount, setLimitAmount] = useState(""); // tokens
  const [expiration, setExpiration] = useState(1000);

  const giveAsset = side === "buy" ? "XCP" : asset;
  const getAsset = side === "buy" ? asset : "XCP";
  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);
  const debouncedRaw = useDebounced(amountRaw, 250);

  const quoteUrl =
    tab === "market" && debouncedRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${giveAsset}/${getAsset}/quote?quantity=${debouncedRaw}`
      : null;
  const {
    data: quote,
    isValidating,
    mutate: mutateQuote,
  } = useSWR<Quote>(
    quoteUrl,
    (url: string) => fetchJson(url).then((d) => d.result),
    {
      refreshInterval: QUOTE_REFRESH_MS,
      keepPreviousData: true,
      onSuccess: () => setLastQuoteAt(Date.now()),
    },
  );

  const { data: pool } = useSWR<PoolInfo | null>(
    tab === "limit" ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP` : null,
    (url: string) => fetchJson(url).then((d) => d.result ?? null),
    { refreshInterval: 30_000 },
  );
  const spot = pool
    ? (pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b) /
      (pool.asset_a === asset ? pool.reserve_a : pool.reserve_b)
    : null;

  const { data: balance } = useSWR(
    address ? [address, giveAsset, "balance"] : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );

  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "confirmed") {
      registerPending({
        txid: compose.txid,
        kind: "order",
        label: `${side === "buy" ? "Buy" : "Sell"} ${asset} — ${tab} order`,
        address: address ?? undefined,
      });
    }
  }, [compose.status, compose.txid, side, asset, tab, address]);


  const staleQuote = isValidating || amountRaw !== debouncedRaw;
  const outRaw = quote && amountRaw > 0 ? quote.estimated_output : 0;
  const minReceivedRaw = Math.floor(outRaw * (1 - slippage / 100));
  const impact = quote?.price_impact ?? 0;
  const insufficient =
    balance !== undefined && amountRaw > 0 && amountRaw > balance;
  const marketReady = amountRaw > 0 && outRaw > 0 && !busy && !insufficient;

  const submitMarket = async () => {
    if (!marketReady || !quote || !quoteUrl) return;
    let fresh = quote;
    try {
      fresh = (await fetchJson(quoteUrl)).result as Quote;
      mutateQuote(fresh, { revalidate: false });
      setLastQuoteAt(Date.now());
      if (fresh.estimated_output < quote.estimated_output * 0.99) {
        setPriceMoved(true);
        return;
      }
    } catch {
      // fall back to the polled quote
    }
    setPriceMoved(false);
    compose.composeOrder({
      give_asset: giveAsset,
      give_quantity: amountRaw,
      get_asset: getAsset,
      get_quantity: Math.floor(fresh.estimated_output * (1 - slippage / 100)),
      expiration: MARKET_EXPIRATION,
    });
  };

  const limitPriceNum = parseFloat(limitPrice) || 0;
  const limitAmountRaw = Math.round((parseFloat(limitAmount) || 0) * SATS);
  const limitTotalRaw = Math.round(limitAmountRaw * limitPriceNum);
  const limitReady = limitPriceNum > 0 && limitAmountRaw > 0 && limitTotalRaw > 0 && !busy;
  // Priced through the pool = fills at confirmation; otherwise it rests.
  const limitFillsNow =
    spot !== null && limitPriceNum > 0
      ? side === "buy"
        ? limitPriceNum >= spot
        : limitPriceNum <= spot
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
            expiration,
          }
        : {
            give_asset: asset,
            give_quantity: limitAmountRaw,
            get_asset: "XCP",
            get_quantity: limitTotalRaw,
            expiration,
          },
    );
  };

  if (compose.status === "confirmed") {
    return (
      <ConfirmCard
        title="Order broadcast"
        onReset={() => compose.reset()}
        resetLabel="Trade again"
      >
        <p className="mt-1 text-green-700">
          <TxLink txid={compose.txid} />
        </p>
        <OrderTracker
          txHash={compose.txid}
          busy={busy}
          onCancel={(hash) => compose.composeCancel({ offer_hash: hash })}
        />
      </ConfirmCard>
    );
  }

  const marketLabel = busy
    ? busyLabel(compose.status)
    : amountRaw === 0
      ? "Enter an amount"
      : insufficient
        ? `Insufficient ${giveAsset} balance`
        : outRaw === 0
          ? staleQuote
            ? "Fetching quote…"
            : "Insufficient liquidity"
          : impact >= 5
            ? `${side === "buy" ? "Buy" : "Sell"} anyway`
            : `${side === "buy" ? "Buy" : "Sell"} ${asset}`;

  return (
    <div
      className={
        only
          ? "rounded-3xl border border-gray-200 bg-white p-4"
          : "rounded-lg border border-gray-200 bg-white p-5"
      }
    >
      {!only && (
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
        {(["market", "limit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 capitalize ${
              tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      )}

      {(
        <div className="mt-3 flex gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={`flex-1 rounded-md border px-3 py-1.5 ${
              side === "buy"
                ? "border-green-600 bg-green-50 text-green-700"
                : "border-gray-300 text-gray-500"
            }`}
          >
            Buy {asset}
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={`flex-1 rounded-md border px-3 py-1.5 ${
              side === "sell"
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-gray-300 text-gray-500"
            }`}
          >
            Sell {asset}
          </button>
        </div>
      )}

      {tab === "market" && (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="trade-amount" className="flex justify-between text-xs text-gray-500">
              <span>{side === "buy" ? "You pay (XCP)" : `You sell (${asset})`}</span>
              {balance !== undefined && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => setAmount(String(balance / SATS))}
                >
                  max {commas(balance / SATS)}
                </button>
              )}
            </label>
            <div className="mt-1 rounded-md border border-gray-300 transition-colors focus-within:border-purple-500">
              <AmountInput
                id="trade-amount"
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setPriceMoved(false);
                }}
                className={`block w-full bg-transparent p-2.5 outline-none ${
                  insufficient ? "text-red-600" : ""
                }`}
              />
            </div>
          </div>
          {quote && amountRaw > 0 && (
            <dl className="space-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <dt>You receive (est.)</dt>
                <dd
                  className="font-semibold text-gray-900"
                  style={{
                    filter: staleQuote ? "grayscale(1)" : "none",
                    opacity: staleQuote ? 0.4 : 1,
                    transition: staleQuote ? "none" : "opacity 250ms ease-in-out",
                  }}
                >
                  {commas(outRaw / SATS)} {getAsset}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt title="Enforced by the order itself — every fill must beat this rate">
                  Min received
                </dt>
                <dd className="font-medium">{commas(minReceivedRaw / SATS)} {getAsset}</dd>
              </div>
              {impact >= 0.5 && (
                <div className="flex justify-between">
                  <dt>Price impact</dt>
                  <dd
                    className={
                      impact >= 5
                        ? "font-semibold text-red-600"
                        : impact >= 3
                          ? "font-medium text-amber-600"
                          : ""
                    }
                  >
                    {impact.toFixed(2)}%
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>Route</dt>
                <dd className="flex items-center gap-1.5">
                  {quote.pool_output > 0 && quote.book_output > 0
                    ? "pool + order book"
                    : quote.pool_output > 0
                      ? "pool"
                      : "order book"}
                  <QuoteRing
                    periodMs={QUOTE_REFRESH_MS}
                    lastUpdated={lastQuoteAt}
                    fetching={staleQuote}
                  />
                </dd>
              </div>
              {quote.fee_bps !== undefined && (
                <div className="flex justify-between">
                  <dt>LP fee</dt>
                  <dd>{quote.fee_bps} bps</dd>
                </div>
              )}
            </dl>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Max slippage</span>
            {SLIPPAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlippage(s)}
                className={`rounded-full border px-2 py-0.5 ${
                  slippage === s
                    ? "border-purple-600 bg-purple-50 text-purple-700"
                    : "border-gray-300"
                }`}
              >
                {s}%
              </button>
            ))}
          </div>
          {priceMoved && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Quote moved — numbers updated. Press again to trade at the new
              price.
            </p>
          )}
          <TradeButton
            walletStatus={walletStatus}
            connect={connect}
            disabled={!marketReady}
            danger={impact >= 5 && marketReady}
            label={marketLabel ?? ""}
            onClick={submitMarket}
          />
        </div>
      )}

      {tab === "limit" && (
        <div className="mt-3 space-y-3">
          <div className={only ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
            <div>
              <label htmlFor="limit-price" className="text-xs text-gray-500">
                Price (XCP per {asset})
              </label>
              <div className="mt-1 rounded-md border border-gray-300 transition-colors focus-within:border-purple-500">
                <AmountInput
                  id="limit-price"
                  value={limitPrice}
                  onChange={setLimitPrice}
                  placeholder={spot ? formatPrice(spot) : "0.0000223"}
                  className="block w-full bg-transparent p-2.5 text-sm outline-none"
                />
              </div>
            </div>
            <div>
              <label htmlFor="limit-amount" className="text-xs text-gray-500">
                Amount ({asset})
              </label>
              <div className="mt-1 rounded-md border border-gray-300 transition-colors focus-within:border-purple-500">
                <AmountInput
                  id="limit-amount"
                  value={limitAmount}
                  onChange={setLimitAmount}
                  className="block w-full bg-transparent p-2.5 text-sm outline-none"
                />
              </div>
            </div>
          </div>
          {spot !== null && (
            <p className="text-xs text-gray-500">
              Pool price: <span className="font-medium">{formatPrice(spot)}</span>
              {limitFillsNow !== null && (
                <span className={limitFillsNow ? " text-green-700" : ""}>
                  {limitFillsNow
                    ? " · fills at confirmation"
                    : " · rests until a counter-order takes it — the pool never auto-fills a resting order"}
                </span>
              )}
            </p>
          )}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              Total:{" "}
              <span className="font-semibold text-gray-900">
                {commas(limitTotalRaw / SATS)} XCP
              </span>
            </span>
            <span className="flex items-center gap-1">
              Expires
              <select
                value={expiration}
                onChange={(e) => setExpiration(Number(e.target.value))}
                className="rounded border border-gray-300 p-1"
              >
                {LIMIT_EXPIRATIONS.map((x) => (
                  <option key={x.blocks} value={x.blocks}>
                    {x.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <TradeButton
            walletStatus={walletStatus}
            connect={connect}
            disabled={!limitReady}
            label={busyLabel(compose.status) ?? `Place limit ${side}`}
            onClick={submitLimit}
          />
        </div>
      )}

      {compose.status === "error" && (
          <ErrorBanner className="mt-3">{compose.error}</ErrorBanner>
        )}
    </div>
  );
}

function busyLabel(status: string): string | null {
  if (status === "composing") return "Composing…";
  if (status === "signing") return "Confirm in wallet…";
  if (status === "broadcasting") return "Broadcasting…";
  return null;
}

function TradeButton({
  walletStatus,
  connect,
  disabled,
  danger,
  label,
  onClick,
}: {
  walletStatus: string;
  connect: () => void;
  disabled: boolean;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  if (walletStatus !== "connected") {
    return (
      <button
        type="button"
        onClick={connect}
        className="w-full rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
      >
        {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-md px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed ${
        danger
          ? "bg-red-600 hover:bg-red-500"
          : "bg-purple-600 hover:bg-purple-500 disabled:bg-gray-200 disabled:text-gray-400"
      }`}
    >
      {label}
    </button>
  );
}
