"use client";

import { useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { OrderTracker } from "@/components/order-tracker";
import { QuoteRing } from "@/components/quote-ring";
import { TokenImage } from "@/components/token-image";
import { TokenSelectModal } from "@/components/token-select-modal";
import { commas, price as formatPrice, usd as usdFmt } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;
/** Market orders live one block: match at confirmation or refund next block. */
const MARKET_EXPIRATION = 1;
const QUOTE_REFRESH_MS = 10_000;
const SLIPPAGE_PRESETS = [0.5, 1, 2];
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
  const [slippagePreset, setSlippagePreset] = useState(1);
  const [customSlippage, setCustomSlippage] = useState("");
  const [customExpiration, setCustomExpiration] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rateInverted, setRateInverted] = useState(false);
  const [flips, setFlips] = useState(0);
  const [priceMoved, setPriceMoved] = useState(false);
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);

  const customSlip = Math.min(parseFloat(customSlippage) || 0, 50);
  const slippage = customSlip > 0 ? customSlip : slippagePreset;
  const expiration = Math.min(
    5000,
    Math.max(1, Math.round(parseFloat(customExpiration)) || MARKET_EXPIRATION),
  );

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
  const amountHuman = amountRaw / SATS;
  const minReceivedRaw = Math.floor(outRaw * (1 - slippage / 100));
  const impact = quote?.price_impact ?? 0;
  const insufficient =
    balance !== undefined && amountRaw > 0 && amountRaw > balance;
  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";
  const ready = amountRaw > 0 && outRaw > 0 && !busy && !insufficient;

  // USD on BOTH sides, derived through the XCP leg of the trade.
  const xcpLeg = side === "buy" ? amountHuman : out;
  const tradeUsd = xcpUsd && xcpLeg > 0 ? xcpLeg * xcpUsd : null;
  const giveUsd =
    giveAsset === "XCP"
      ? xcpUsd && amountHuman > 0
        ? amountHuman * xcpUsd
        : null
      : tradeUsd;
  const getUsd = getAsset === "XCP" ? tradeUsd : out > 0 ? tradeUsd : null;

  // Rate line: 1 <base> = <rate> <quote asset>, tap to invert.
  const rate = out > 0 && amountHuman > 0 ? out / amountHuman : null;
  const rateText =
    rate !== null
      ? rateInverted
        ? `1 ${getAsset} = ${formatPrice(1 / rate)} ${giveAsset}`
        : `1 ${giveAsset} = ${formatPrice(rate)} ${getAsset}`
      : null;
  const rateBaseUsd =
    rate !== null && xcpUsd
      ? rateInverted
        ? getAsset === "XCP"
          ? xcpUsd
          : (xcpLeg / (side === "buy" ? out : amountHuman)) * xcpUsd
        : giveAsset === "XCP"
          ? xcpUsd
          : (xcpLeg / (side === "buy" ? out : amountHuman)) * xcpUsd
      : null;

  const submit = async () => {
    if (!ready || !quote || !quoteUrl) return;
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
      expiration,
    });
  };

  const flip = () => {
    setFlips((f) => f + 1);
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

  // On a single-asset surface (the asset page) the chip is identity, not a
  // control — no chevron, no modal.
  const tokenChip =
    assets.length === 1 ? (
      <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm">
        <TokenImage asset={asset} className="size-6 rounded-full bg-gray-100 object-cover" />
        <span className="text-sm font-semibold">{asset}</span>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setSelectorOpen(true)}
        className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm transition-all hover:border-gray-300 hover:shadow active:scale-[0.97]"
      >
        <TokenImage asset={asset} className="size-6 rounded-full bg-gray-100 object-cover" />
        <span className="text-sm font-semibold">{asset}</span>
        <span aria-hidden className="text-xs text-gray-400">
          ▾
        </span>
      </button>
    );

  const xcpChip = (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm">
      <span className="flex size-6 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
        X
      </span>
      <span className="text-sm font-semibold">XCP</span>
    </div>
  );

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
      {/* Settings row */}
      <div className="relative flex items-center justify-end px-2 pb-1 pt-0.5">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Swap settings"
          className={`flex size-7 items-center justify-center rounded-full transition-colors ${
            settingsOpen || customSlip > 0 || expiration !== MARKET_EXPIRATION
              ? "bg-purple-50 text-purple-600"
              : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
            <path
              fillRule="evenodd"
              d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {settingsOpen && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setSettingsOpen(false)}
            />
            <div className="modal-pop absolute right-0 top-9 z-30 w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg">
              <div className="text-xs font-medium text-gray-500">Max slippage</div>
              <div className="mt-2 flex items-center gap-1.5">
                {SLIPPAGE_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSlippagePreset(s);
                      setCustomSlippage("");
                    }}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                      slippage === s && customSlip === 0
                        ? "border-purple-600 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {s}%
                  </button>
                ))}
                <div
                  className={`flex items-center rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
                    customSlip > 0 ? "border-purple-600 bg-purple-50" : "border-gray-200"
                  }`}
                >
                  <AmountInput
                    value={customSlippage}
                    onChange={setCustomSlippage}
                    placeholder="1.5"
                    ariaLabel="Custom slippage percent"
                    className="w-8 bg-transparent text-right text-xs font-medium outline-none"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
              </div>
              {slippage < 0.5 && (
                <p className="mt-2 text-[11px] text-amber-600">
                  Below 0.5% the order may not fill.
                </p>
              )}
              {slippage > 5 && (
                <p className="mt-2 text-[11px] text-red-600">
                  High slippage authorizes up to {slippage}% price impact.
                </p>
              )}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">
                  Expiration
                </span>
                <span
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
                    expiration !== MARKET_EXPIRATION
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200"
                  }`}
                >
                  <AmountInput
                    value={customExpiration}
                    onChange={setCustomExpiration}
                    placeholder={String(MARKET_EXPIRATION)}
                    ariaLabel="Order expiration in blocks"
                    className="w-10 bg-transparent text-right text-xs font-medium outline-none"
                  />
                  <span className="text-xs text-gray-400">blocks</span>
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                How long an unfilled remainder rests before auto-refund.{" "}
                {MARKET_EXPIRATION} = fill at confirmation or refund next
                block.
              </p>
              <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
                Min received is enforced by the order itself — worse fills are
                impossible; better ones refund the difference.
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sell well — inset follows focus; balance row swaps to presets on hover */}
      <div className="group rounded-2xl border border-transparent bg-gray-50 p-4 transition-colors focus-within:border-gray-200 focus-within:bg-white">
        <div className="flex h-5 items-center justify-between text-xs text-gray-500">
          <span>Sell</span>
          {balance !== undefined && (
            <>
              <button
                type="button"
                className="group-focus-within:hidden group-hover:hidden"
                onClick={() => setAmount(fmtAmount(balance / SATS))}
              >
                Balance: {commas(balance / SATS)}
              </button>
              <span className="hidden items-center gap-1 group-focus-within:flex group-hover:flex">
                {balance > 0 ? (
                  PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setAmount(fmtAmount(Math.floor((balance * p) / 100) / SATS))
                      }
                      className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                    >
                      {p === 100 ? "Max" : `${p}%`}
                    </button>
                  ))
                ) : (
                  <span>Balance: 0</span>
                )}
              </span>
            </>
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
            className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
              insufficient ? "text-red-600" : "text-gray-900"
            }`}
          />
          {giveAsset === "XCP" ? xcpChip : tokenChip}
        </div>
        <div className="mt-1 h-4 text-xs text-gray-400">
          {giveUsd !== null && `≈ ${usdFmt(giveUsd)}`}
        </div>
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
        <div className="flex h-5 items-center text-xs text-gray-500">Buy</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div
            className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
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
        <div className="mt-1 h-4 text-xs text-gray-400">
          {getUsd !== null && `≈ ${usdFmt(getUsd)}`}
        </div>
      </div>

      {/* Rate line + expandable details */}
      {rateText && (
        <div className="px-2 pt-2">
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setRateInverted((v) => !v)}
              title="Invert rate"
              className="text-gray-600 hover:text-gray-900"
            >
              {rateText}
              {rateBaseUsd !== null && (
                <span className="text-gray-400"> ({usdFmt(rateBaseUsd)})</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-label="Trade details"
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600"
            >
              {impact >= 3 && (
                <span
                  className={`font-medium ${impact >= 5 ? "text-red-600" : "text-amber-600"}`}
                >
                  {impact.toFixed(1)}%
                </span>
              )}
              <QuoteRing
                periodMs={QUOTE_REFRESH_MS}
                lastUpdated={lastQuoteAt}
                fetching={staleQuote}
              />
              <span
                aria-hidden
                className="inline-block transition-transform duration-100"
                style={{ transform: detailsOpen ? "rotate(180deg)" : "none" }}
              >
                ▾
              </span>
            </button>
          </div>
          {detailsOpen && (
            <dl className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Min received</dt>
                <dd className="font-medium text-gray-700">
                  {commas(minReceivedRaw / SATS)} {getAsset}
                </dd>
              </div>
              {impact >= 0.5 && (
                <div className="flex justify-between">
                  <dt>Price impact</dt>
                  <dd
                    className={
                      impact >= 5
                        ? "font-medium text-red-600"
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
                <dt>Max slippage</dt>
                <dd>{slippage}%</dd>
              </div>
              <div className="flex justify-between">
                <dt>Route</dt>
                <dd>
                  {quote!.pool_output > 0 && quote!.book_output > 0
                    ? "Pool + order book"
                    : quote!.pool_output > 0
                      ? "Pool"
                      : "Order book"}
                </dd>
              </div>
              {quote!.fee_bps !== undefined && quote!.pool_output > 0 && (
                <div className="flex justify-between">
                  <dt>LP fee</dt>
                  <dd>{(quote!.fee_bps / 100).toFixed(2)}%</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      <div className="px-0.5 pb-0.5 pt-3">
        {priceMoved && (
          <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Quote moved — the numbers above are updated. Press again to swap
            at the new price.
          </p>
        )}

        {compose.status === "error" && (
          <p className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {compose.error}
          </p>
        )}

        {walletStatus !== "connected" ? (
          <button
            type="button"
            onClick={() => connect()}
            className="w-full rounded-2xl bg-gray-900 px-5 py-3.5 font-medium text-white transition-all hover:bg-gray-700 active:scale-[0.99]"
          >
            {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={submit}
            className={`w-full rounded-2xl px-5 py-3.5 font-medium text-white transition-all active:scale-[0.99] disabled:cursor-not-allowed ${
              impact >= 5 && ready
                ? "bg-red-600 hover:bg-red-500"
                : "bg-purple-600 hover:bg-purple-500 disabled:bg-gray-200 disabled:text-gray-400"
            }`}
          >
            {buttonLabel}
          </button>
        )}
      </div>

      <TokenSelectModal
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        assets={assets}
        selected={asset}
        address={address}
        onSelect={(a) => {
          setAsset(a);
          setAmount("");
          setPriceMoved(false);
        }}
      />
    </div>
  );
}
