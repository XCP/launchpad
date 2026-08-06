"use client";

import { useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { OrderTracker } from "@/components/order-tracker";
import { QuoteRing } from "@/components/quote-ring";
import { TokenImage } from "@/components/token-image";
import { commas, usd as usdFmt } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;
/**
 * Market orders live one block: they match at confirmation and any
 * remainder is refunded the next block. Fills, or it doesn't.
 */
const MARKET_EXPIRATION = 1;
const QUOTE_REFRESH_MS = 10_000;
const SLIPPAGES = [0.5, 1, 2];
const PRESETS = [25, 50, 75, 100] as const;

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

/** Human amount without float noise or exponent notation. */
const fmtAmount = (n: number) => n.toFixed(8).replace(/\.?0+$/, "");

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
  const [flips, setFlips] = useState(0);
  const [priceMoved, setPriceMoved] = useState(false);
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);

  const giveAsset = side === "buy" ? "XCP" : asset;
  const getAsset = side === "buy" ? asset : "XCP";
  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);
  const debouncedRaw = useDebounced(amountRaw, 250);

  const quoteUrl =
    asset && debouncedRaw > 0
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

  const { data: balance } = useSWR(
    address && giveAsset ? [address, giveAsset, "swap-balance"] : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );

  const staleQuote = isValidating || amountRaw !== debouncedRaw;
  const outRaw = quote && amountRaw > 0 ? quote.estimated_output : 0;
  const out = outRaw / SATS;
  const minReceivedRaw = Math.floor(outRaw * (1 - slippage / 100));
  const impact = quote?.price_impact ?? 0;
  const insufficient =
    balance !== undefined && amountRaw > 0 && amountRaw > balance;
  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";
  const ready = amountRaw > 0 && outRaw > 0 && !busy && !insufficient;

  const submit = async () => {
    if (!ready || !quote || !quoteUrl) return;
    // Price-moved guard: re-quote at the moment of submit; block one-sided
    // when >1% worse than what's on screen (improvements pass silently).
    let fresh = quote;
    try {
      fresh = (await fetchJson(quoteUrl)).result as Quote;
      if (fresh.estimated_output < quote.estimated_output * 0.99) {
        mutateQuote(fresh, { revalidate: false });
        setLastQuoteAt(Date.now());
        setPriceMoved(true);
        return;
      }
      mutateQuote(fresh, { revalidate: false });
      setLastQuoteAt(Date.now());
    } catch {
      // network hiccup — fall back to the polled quote
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

  const flip = () => {
    setFlips((f) => f + 1);
    // Carry the quoted output across: "sell 1 XCP → 50k TOK" flips to
    // "sell 50k TOK", so the trade reverses instead of resetting.
    if (out > 0) setAmount(fmtAmount(out));
    setSide(side === "buy" ? "sell" : "buy");
    setPriceMoved(false);
  };

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-3xl border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">Swap broadcast</div>
        <p className="mt-1 text-green-700">
          <a
            href={`https://xcp.io/tx/${compose.txid}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {compose.txid.slice(0, 12)}…
          </a>
        </p>
        <OrderTracker
          txHash={compose.txid}
          busy={busy}
          onCancel={(hash) => compose.composeCancel({ offer_hash: hash })}
        />
        <button
          type="button"
          onClick={compose.reset}
          className="mt-3 text-green-800 underline"
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
          setPriceMoved(false);
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
  const getUsd = getAsset === "XCP" && xcpUsd && out > 0 ? usdFmt(out * xcpUsd) : null;

  const buttonLabel = busy
    ? compose.status === "composing"
      ? "Composing…"
      : compose.status === "signing"
        ? "Confirm in wallet…"
        : "Broadcasting…"
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
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* Sell well — the inset look follows focus */}
      <div className="rounded-2xl border border-transparent bg-gray-50 p-4 transition-colors focus-within:border-gray-200 focus-within:bg-white">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Sell</span>
          {balance !== undefined && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="hover:text-gray-700 hover:underline"
                onClick={() => setAmount(fmtAmount(balance / SATS))}
              >
                Balance: {commas(balance / SATS)}
              </button>
              {balance > 0 &&
                PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setAmount(fmtAmount(Math.floor((balance * p) / 100) / SATS))
                    }
                    className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 hover:border-purple-400 hover:text-purple-600"
                  >
                    {p === 100 ? "Max" : `${p}%`}
                  </button>
                ))}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <AmountInput
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setPriceMoved(false);
            }}
            ariaLabel={`Amount of ${giveAsset} to sell`}
            className={`w-full min-w-0 bg-transparent text-3xl font-semibold outline-none placeholder:text-gray-300 ${
              insufficient ? "text-red-600" : "text-gray-900"
            }`}
          />
          {giveAsset === "XCP" ? xcpChip : tokenChip}
        </div>
        <div className="mt-1 h-4 text-xs text-gray-400">{giveUsd && `≈ ${giveUsd}`}</div>
      </div>

      {/* Flip — ring in the card color punches through the seam */}
      <div className="relative z-10 h-0.5">
        <button
          type="button"
          onClick={flip}
          aria-label="Flip direction"
          title="Flip direction"
          className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gray-50 text-gray-500 shadow-[0_0_0_4px_white] transition-transform duration-300 hover:bg-gray-100 hover:text-purple-600 active:scale-95"
          style={{ transform: `translate(-50%, -50%) rotate(${flips * 180}deg)` }}
        >
          ↓
        </button>
      </div>

      {/* Buy well */}
      <div className="rounded-2xl bg-gray-50 p-4">
        <div className="text-xs text-gray-500">Buy</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div
            className={`w-full min-w-0 truncate text-3xl font-semibold ${
              out > 0 ? "text-gray-900" : "text-gray-300"
            }`}
            style={{
              filter: staleQuote && out > 0 ? "grayscale(1)" : "none",
              opacity: staleQuote && out > 0 ? 0.4 : 1,
              transition: staleQuote ? "none" : "opacity 250ms ease-in-out",
            }}
          >
            {out > 0 ? commas(out) : "0"}
          </div>
          {getAsset === "XCP" ? xcpChip : tokenChip}
        </div>
        <div className="mt-1 flex h-4 items-center justify-between text-xs text-gray-400">
          <span>{getUsd && `≈ ${getUsd}`}</span>
          {quote && amountRaw > 0 && (
            <span className="flex items-center gap-1.5">
              {quote.pool_output > 0 && quote.book_output > 0
                ? "pool + book"
                : quote.pool_output > 0
                  ? "pool"
                  : "order book"}
              {impact >= 0.5 && (
                <span
                  className={
                    impact >= 5
                      ? "font-medium text-red-600"
                      : impact >= 3
                        ? "font-medium text-amber-600"
                        : impact >= 1
                          ? "text-gray-500"
                          : ""
                  }
                >
                  · impact {impact.toFixed(2)}%
                </span>
              )}
              <QuoteRing
                periodMs={QUOTE_REFRESH_MS}
                lastUpdated={lastQuoteAt}
                fetching={staleQuote}
              />
            </span>
          )}
        </div>
      </div>

      <div className="px-2 pb-1 pt-3">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-2">
            <span>Slippage</span>
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
          </span>
          {minReceivedRaw > 0 && (
            <span title="Enforced by the order itself — every fill must beat this rate">
              Min received:{" "}
              <span className="font-medium text-gray-700">
                {commas(minReceivedRaw / SATS)}
              </span>
            </span>
          )}
        </div>

        {priceMoved && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Quote moved — the numbers above are updated. Press again to swap
            at the new price.
          </p>
        )}

        {compose.status === "error" && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {compose.error}
          </p>
        )}

        {walletStatus !== "connected" ? (
          <button
            type="button"
            onClick={() => connect()}
            className="mt-3 w-full rounded-2xl bg-gray-900 px-5 py-3.5 font-medium text-white hover:bg-gray-700"
          >
            {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={submit}
            className={`mt-3 w-full rounded-2xl px-5 py-3.5 font-medium text-white disabled:cursor-not-allowed ${
              impact >= 5 && ready
                ? "bg-red-600 hover:bg-red-500"
                : "bg-purple-600 hover:bg-purple-500 disabled:bg-gray-200 disabled:text-gray-400"
            }`}
          >
            {buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}
