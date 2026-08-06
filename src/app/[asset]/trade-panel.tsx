"use client";

import { useState } from "react";
import useSWR from "swr";
import { commas, price as formatPrice } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Trading for graduated launches, built on the one primitive Counterparty
 * has: the DEX order. Matching routes through the AMM pool whenever the
 * pool's marginal price beats the book, so:
 *  - Market  = an order at the router's quoted output minus slippage — fills
 *    from pool + book immediately; any dust expires in ~3 hours.
 *  - Limit   = the same message at your price — rests on the book; the pool
 *    fills it when its price crosses yours.
 *  - Orders  = your open orders on this pair, cancellable.
 */

const SATS = 1e8;
const MARKET_EXPIRATION = 20; // blocks — quoted fills land immediately; dust dies fast
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

interface OpenOrder {
  tx_hash: string;
  give_asset: string;
  get_asset: string;
  give_quantity: number;
  get_quantity: number;
  give_remaining: number;
  get_remaining: number;
  expire_index: number;
}

const fetchJson = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

async function fetchBalance(address: string, asset: string): Promise<number> {
  const data = await fetchJson(
    `${COUNTERPARTY_API_BASE}/addresses/${address}/balances/${asset}`,
  );
  const rows: { quantity: number }[] = Array.isArray(data.result)
    ? data.result
    : data.result
      ? [data.result]
      : [];
  return rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
}

export function TradePanel({ asset }: { asset: string }) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [tab, setTab] = useState<"market" | "limit" | "orders">("market");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(""); // human units of the GIVE asset
  const [slippage, setSlippage] = useState(1);
  const [limitPrice, setLimitPrice] = useState(""); // XCP per token
  const [limitAmount, setLimitAmount] = useState(""); // tokens
  const [expiration, setExpiration] = useState(1000);

  const giveAsset = side === "buy" ? "XCP" : asset;
  const getAsset = side === "buy" ? asset : "XCP";
  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);

  const { data: quote } = useSWR<Quote>(
    tab === "market" && amountRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${giveAsset}/${getAsset}/quote?quantity=${amountRaw}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 10_000 },
  );

  const { data: balance } = useSWR(
    address ? [address, giveAsset, "balance"] : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );

  const { data: orders, mutate: refreshOrders } = useSWR<OpenOrder[]>(
    tab === "orders" && address
      ? `${COUNTERPARTY_API_BASE}/addresses/${address}/orders?status=open&limit=100`
      : null,
    (url: string) =>
      fetchJson(url).then((d) =>
        (d.result as OpenOrder[]).filter(
          (o) =>
            (o.give_asset === asset && o.get_asset === "XCP") ||
            (o.give_asset === "XCP" && o.get_asset === asset),
        ),
      ),
    { refreshInterval: 15_000 },
  );

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";

  const marketReady = amountRaw > 0 && (quote?.estimated_output ?? 0) > 0 && !busy;

  const submitMarket = () => {
    if (!marketReady || !quote) return;
    compose.composeOrder({
      give_asset: giveAsset,
      give_quantity: amountRaw,
      get_asset: getAsset,
      get_quantity: Math.floor(quote.estimated_output * (1 - slippage / 100)),
      expiration: MARKET_EXPIRATION,
    });
  };

  const limitPriceNum = parseFloat(limitPrice) || 0;
  const limitAmountRaw = Math.round((parseFloat(limitAmount) || 0) * SATS);
  const limitTotalRaw = Math.round(limitAmountRaw * limitPriceNum);
  const limitReady = limitPriceNum > 0 && limitAmountRaw > 0 && limitTotalRaw > 0 && !busy;

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
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">Order broadcast</div>
        <p className="mt-1 text-green-700">
          Matching runs at confirmation — pool first while it beats the book.{" "}
          <a
            href={`https://xcp.io/tx/${compose.txid}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {compose.txid.slice(0, 12)}…
          </a>
        </p>
        <button
          type="button"
          onClick={() => {
            compose.reset();
            refreshOrders();
          }}
          className="mt-2 text-green-800 underline"
        >
          Trade again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
        {(["market", "limit", "orders"] as const).map((t) => (
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

      {tab !== "orders" && (
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
            <input
              id="trade-amount"
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="mt-1 block w-full rounded-md border border-gray-300 p-2.5 outline-none focus:border-purple-500"
            />
          </div>
          {quote && amountRaw > 0 && (
            <dl className="space-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <dt>You receive (est.)</dt>
                <dd className="font-semibold text-gray-900">
                  {commas(quote.estimated_output / SATS)} {getAsset}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Price impact</dt>
                <dd className={quote.price_impact > 5 ? "font-semibold text-red-600" : ""}>
                  {quote.price_impact.toFixed(2)}%
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Route</dt>
                <dd>
                  {quote.pool_output > 0 && quote.book_output > 0
                    ? "pool + order book"
                    : quote.pool_output > 0
                      ? "pool"
                      : "order book"}
                </dd>
              </div>
              {quote.fee_bps !== undefined && (
                <div className="flex justify-between">
                  <dt>Pool fee</dt>
                  <dd>{quote.fee_bps} bps (deepens locked liquidity)</dd>
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
          <TradeButton
            walletStatus={walletStatus}
            connect={connect}
            disabled={!marketReady}
            busyLabel={busyLabel(compose.status)}
            label={`${side === "buy" ? "Buy" : "Sell"} ${asset}`}
            onClick={submitMarket}
          />
        </div>
      )}

      {tab === "limit" && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="limit-price" className="text-xs text-gray-500">
                Price (XCP per {asset})
              </label>
              <input
                id="limit-price"
                type="number"
                min={0}
                step="any"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="0.0000223"
                className="mt-1 block w-full rounded-md border border-gray-300 p-2.5 text-sm outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label htmlFor="limit-amount" className="text-xs text-gray-500">
                Amount ({asset})
              </label>
              <input
                id="limit-amount"
                type="number"
                min={0}
                step="any"
                value={limitAmount}
                onChange={(e) => setLimitAmount(e.target.value)}
                placeholder="0"
                className="mt-1 block w-full rounded-md border border-gray-300 p-2.5 text-sm outline-none focus:border-purple-500"
              />
            </div>
          </div>
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
          <p className="text-xs text-gray-400">
            Rests on the DEX book. The pool fills it automatically if its price
            crosses yours; funds stay escrowed by the protocol until matched,
            cancelled, or expired.
          </p>
          <TradeButton
            walletStatus={walletStatus}
            connect={connect}
            disabled={!limitReady}
            busyLabel={busyLabel(compose.status)}
            label={`Place limit ${side}`}
            onClick={submitLimit}
          />
        </div>
      )}

      {tab === "orders" && (
        <div className="mt-3">
          {walletStatus !== "connected" ? (
            <p className="p-3 text-center text-sm text-gray-500">
              Connect your wallet to see your open orders.
            </p>
          ) : !orders || orders.length === 0 ? (
            <p className="p-3 text-center text-sm text-gray-500">
              No open orders on this pair.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {orders.map((o) => {
                const isBuy = o.get_asset === asset;
                const tokens = isBuy ? o.get_quantity : o.give_quantity;
                const xcp = isBuy ? o.give_quantity : o.get_quantity;
                const filled =
                  1 - (isBuy ? o.give_remaining / o.give_quantity : o.give_remaining / o.give_quantity);
                return (
                  <li key={o.tx_hash} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <span className={isBuy ? "font-medium text-green-700" : "font-medium text-red-600"}>
                        {isBuy ? "Buy" : "Sell"}
                      </span>{" "}
                      {commas(tokens / SATS)} @ {formatPrice(xcp / tokens)}
                      <span className="ml-2 text-xs text-gray-400">
                        {(filled * 100).toFixed(0)}% filled · expires block{" "}
                        {o.expire_index.toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => compose.composeCancel({ offer_hash: o.tx_hash })}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {compose.status === "error" && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {compose.error}
        </p>
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
  busyLabel,
  label,
  onClick,
}: {
  walletStatus: string;
  connect: () => void;
  disabled: boolean;
  busyLabel: string | null;
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
      className="w-full rounded-md bg-purple-600 px-5 py-2.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busyLabel ?? label}
    </button>
  );
}
