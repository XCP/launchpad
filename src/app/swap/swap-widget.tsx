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
 * Swaps between XCP and XCP-69 pools in the two-card grammar every swap UI
 * shares: Sell on top, Buy below, a flip arrow overlapping the seam. Under
 * the hood it's a DEX order at the router's quoted output minus slippage —
 * pool + book, best price first, dust expires in ~3 hours.
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

  const outXcp = quote && amountRaw > 0 ? quote.estimated_output / SATS : 0;
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
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-sm">
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

  const tokenChip = (
    <div className="relative flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm hover:border-gray-300">
      <TokenImage asset={asset} className="size-6 rounded-full bg-gray-100 object-cover" />
      <span className="text-sm font-semibold">{asset}</span>
      <span aria-hidden className="text-xs text-gray-400">
        ▾
      </span>
      <select
        aria-label="Token to trade"
        value={asset}
        onChange={(e) => {
          setAsset(e.target.value);
          setAmount("");
        }}
        className="absolute inset-0 opacity-0"
      >
        {assets.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );

  const xcpChip = (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm">
      <span className="flex size-6 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
        X
      </span>
      <span className="text-sm font-semibold">XCP</span>
    </div>
  );

  const giveUsd =
    giveAsset === "XCP" && xcpUsd && amountRaw > 0
      ? usdFmt((amountRaw / SATS) * xcpUsd)
      : null;
  const getUsd =
    getAsset === "XCP" && xcpUsd && outXcp > 0 ? usdFmt(outXcp * xcpUsd) : null;

  return (
    <div>
      {/* Sell card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Sell</span>
          {balance !== undefined && (
            <button
              type="button"
              className="underline hover:text-gray-700"
              onClick={() => setAmount(String(balance / SATS))}
            >
              Balance: {commas(balance / SATS)} · Max
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <input
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            aria-label={`Amount of ${giveAsset} to sell`}
            className="w-full min-w-0 bg-transparent text-3xl font-semibold text-gray-900 outline-none placeholder:text-gray-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {giveAsset === "XCP" ? xcpChip : tokenChip}
        </div>
        <div className="mt-1 h-4 text-xs text-gray-400">{giveUsd && `≈ ${giveUsd}`}</div>
      </div>

      {/* Flip arrow overlapping the seam */}
      <div className="relative z-10 -my-3 flex justify-center">
        <button
          type="button"
          onClick={() => {
            setSide(side === "buy" ? "sell" : "buy");
            setAmount("");
          }}
          aria-label="Flip direction"
          title="Flip direction"
          className="flex size-9 items-center justify-center rounded-xl border-4 border-gray-50 bg-white text-gray-500 shadow-sm hover:text-purple-600"
        >
          ↓
        </button>
      </div>

      {/* Buy card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-500">Buy</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div
            className={`w-full min-w-0 truncate text-3xl font-semibold ${
              outXcp > 0 ? "text-gray-900" : "text-gray-300"
            }`}
          >
            {outXcp > 0 ? commas(outXcp) : "0"}
          </div>
          {getAsset === "XCP" ? xcpChip : tokenChip}
        </div>
        <div className="mt-1 flex h-4 items-center justify-between text-xs text-gray-400">
          <span>{getUsd && `≈ ${getUsd}`}</span>
          {quote && amountRaw > 0 && (
            <span className={quote.price_impact > 5 ? "font-medium text-red-600" : ""}>
              {quote.pool_output > 0 && quote.book_output > 0
                ? "pool + book"
                : quote.pool_output > 0
                  ? "pool"
                  : "order book"}{" "}
              · impact {quote.price_impact.toFixed(2)}%
            </span>
          )}
        </div>
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
          className="mt-3 w-full rounded-xl bg-gray-900 px-5 py-3 font-medium text-white hover:bg-gray-700"
        >
          {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
        </button>
      ) : (
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="mt-3 w-full rounded-xl bg-purple-600 px-5 py-3 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
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
