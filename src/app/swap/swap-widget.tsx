"use client";

import { useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { commas, usd as usdFmt } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;
const MARKET_EXPIRATION = 20; // blocks — fills land immediately, dust dies fast
const SLIPPAGES = [0.5, 1, 2];

interface Quote {
  estimated_output: number;
  pool_output: number;
  book_output: number;
  price_impact: number;
  fee_bps?: number;
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

/**
 * Swaps between XCP and XCP-69 graduates only — one leg is always XCP, the
 * other always a launch that passed conformance and seeded its pool. Under
 * the hood it's a DEX order at the router's quoted output minus slippage:
 * fills from the pool and book at best price, dust expires in ~3 hours.
 */
export function SwapWidget({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [asset, setAsset] = useState(assets[0] ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);

  const giveAsset = side === "buy" ? "XCP" : asset;
  const getAsset = side === "buy" ? asset : "XCP";
  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);

  const { data: quote } = useSWR<Quote>(
    asset && amountRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${giveAsset}/${getAsset}/quote?quantity=${amountRaw}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 10_000 },
  );

  const { data: balance } = useSWR(
    address && giveAsset ? [address, giveAsset, "swap-balance"] : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";
  const ready = amountRaw > 0 && (quote?.estimated_output ?? 0) > 0 && !busy;

  const submit = () => {
    if (!ready || !quote) return;
    compose.composeOrder({
      give_asset: giveAsset,
      give_quantity: amountRaw,
      get_asset: getAsset,
      get_quantity: Math.floor(quote.estimated_output * (1 - slippage / 100)),
      expiration: MARKET_EXPIRATION,
    });
  };

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">Swap broadcast</div>
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
          onClick={compose.reset}
          className="mt-2 text-green-800 underline"
        >
          Swap again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <TokenImage asset={asset} className="size-10 rounded-full bg-gray-100 object-cover" />
        <select
          value={asset}
          onChange={(e) => {
            setAsset(e.target.value);
            setAmount("");
          }}
          aria-label="Token to trade"
          className="block flex-1 rounded-md border border-gray-300 bg-white p-2.5 text-sm font-medium outline-none focus:border-purple-500"
        >
          {assets.map((a) => (
            <option key={a} value={a}>
              {a} / XCP
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="swap-amount" className="flex justify-between text-xs text-gray-500">
          <span>
            You pay ({giveAsset})
            {giveAsset === "XCP" && xcpUsd && amountRaw > 0
              ? ` ≈ ${usdFmt((amountRaw / SATS) * xcpUsd)}`
              : ""}
          </span>
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
          id="swap-amount"
          type="number"
          min={0}
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="mt-1 block w-full rounded-md border border-gray-300 p-2.5 outline-none focus:border-purple-500"
        />
      </div>

      <div className="my-2 flex justify-center">
        <button
          type="button"
          onClick={() => {
            setSide(side === "buy" ? "sell" : "buy");
            setAmount("");
          }}
          aria-label="Flip direction"
          title="Flip direction"
          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 hover:border-purple-400 hover:text-purple-600"
        >
          ⇅
        </button>
      </div>

      <div className="rounded-md bg-gray-50 p-3 text-sm">
        <div className="flex justify-between text-xs text-gray-500">
          <span>You receive (est.)</span>
        </div>
        <div className="mt-0.5 font-semibold text-gray-900">
          {quote && amountRaw > 0 ? commas(quote.estimated_output / SATS) : "0"}{" "}
          {getAsset}
          {getAsset === "XCP" && xcpUsd && quote && amountRaw > 0 ? (
            <span className="text-xs font-normal text-gray-400">
              {" "}
              ≈ {usdFmt((quote.estimated_output / SATS) * xcpUsd)}
            </span>
          ) : null}
        </div>
        {quote && amountRaw > 0 && (
          <div className="mt-1 flex justify-between text-xs text-gray-500">
            <span>
              Route:{" "}
              {quote.pool_output > 0 && quote.book_output > 0
                ? "pool + order book"
                : quote.pool_output > 0
                  ? "pool"
                  : "order book"}
            </span>
            <span className={quote.price_impact > 5 ? "font-medium text-red-600" : ""}>
              impact {quote.price_impact.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
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

      {compose.status === "error" && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {compose.error}
        </p>
      )}

      {walletStatus !== "connected" ? (
        <button
          type="button"
          onClick={() => connect()}
          className="mt-4 w-full rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
        >
          {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
        </button>
      ) : (
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="mt-4 w-full rounded-md bg-purple-600 px-5 py-2.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {compose.status === "composing"
            ? "Composing…"
            : compose.status === "signing"
              ? "Confirm in wallet…"
              : compose.status === "broadcasting"
                ? "Broadcasting…"
                : side === "buy"
                  ? `Buy ${asset}`
                  : `Sell ${asset}`}
        </button>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Executes as a DEX order at the quoted price minus your slippage —
        filled from the locked pool and the order book, best price first.
        Unfilled remainder expires in ~3 hours.
      </p>
    </div>
  );
}
