"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { AssetChip } from "@/components/asset-chip";
import { ConnectButton } from "@/components/connect-button";
import { OrderTracker } from "@/components/order-tracker";
import { QuoteRing } from "@/components/quote-ring";
import { TokenSelectModal } from "@/components/token-select-modal";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { FlipNotch } from "@/components/ui/flip-notch";
import { Well } from "@/components/ui/well";
import { fetchBtcUsd } from "@/lib/api/price-client";
import { fetchJson } from "@/lib/client";
import { commasRaw, compact as compactFmt, price as formatPrice, satsPerVb, usd as usdFmt } from "@/lib/format";
import {
  approx,
  parseUnitsToRaw,
  percentOf,
  type Raw,
  ratio,
  reduceByPercent,
  SATS,
} from "@/lib/numeric";
import { useDebounced } from "@/hooks/use-debounced";
import { trackTx } from "@/lib/analytics";
import { registerPending } from "@/lib/pending";
import { useSpendableBalance } from "@/hooks/use-spendable-balance";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { useSwapSettings } from "@/app/swap/_components/swap-settings";
import {
  defaultTradeAsset,
  selectTradeAsset,
  type TradePairLeg,
} from "@/lib/trade-selection";

/** Typical composed order size (1–2 inputs, OP_RETURN, change) for the
 *  TX-fee estimate; the true size is known only after compose. */
const ORDER_VBYTES = 250;
/** Ten-minute blocks — a minute-old quote is still fresh by chain time. */
const QUOTE_REFRESH_MS = 60_000;
const PRESETS = [25, 50, 75, 100] as const;

interface Quote {
  estimated_output: Raw;
  pool_output: Raw;
  book_output: Raw;
  /** A percentage, not a quantity — small by construction. */
  price_impact: number;
  fee_bps?: number;
}

const fmtAmount = (n: number) => n.toFixed(8).replace(/\.?0+$/, "");

export function SwapWidget({
  assets,
  xcpUsd,
  compact = false,
}: {
  assets: string[];
  xcpUsd: number | null;
  /** Tight-rail mode (asset-page sidebar): wells stack the chip below. */
  compact?: boolean;
}) {
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const [giveAsset, setGiveAsset] = useState("XCP");
  const [getAsset, setGetAsset] = useState(() => defaultTradeAsset(assets));
  const [amount, setAmount] = useState("");
  const [selectorLeg, setSelectorLeg] = useState<TradePairLeg | null>(null);
  const [rateInverted, setRateInverted] = useState(false);
  const [flips, setFlips] = useState(0);
  const [priceMoved, setPriceMoved] = useState(false);
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);

  // Settings live beside the mode tabs; the widget consumes the values
  // and publishes what the current trade needs for Auto slippage.
  const {
    slippage,
    slippageAuto,
    customSlip,
    expiration,
    customFee,
    medianFeeRate,
    setAutoValue,
  } = useSwapSettings();

  // The Bitcoin cost of pressing the button: rate from settings (next-block
  // median by default). Total is an estimate — the composed size varies
  // with UTXO count — but the rate is exactly what compose will pay.
  const { data: btcUsd } = useSWR(
    "btc-usd",
    fetchBtcUsd,
    { refreshInterval: 60_000 },
  );
  const feeRate = customFee > 0 ? customFee : (medianFeeRate ?? null);

  const action =
    giveAsset === "XCP" ? "buy" : getAsset === "XCP" ? "sell" : "swap";
  const actionLabel =
    action === "buy" ? "Buy" : action === "sell" ? "Sell" : "Swap";
  const selectableAssets = [
    "XCP",
    ...assets.filter((asset) => asset !== "XCP"),
  ];
  // Parse the typed digits exactly (a full XCP-69 bag is 10^16 raw, past
  // double precision); the double beside it feeds UI-only paths.
  const amountExact = parseUnitsToRaw(amount) ?? 0n;
  const amountRaw = approx(amountExact);
  const debouncedRaw = useDebounced(amountRaw, 250);

  const quoteUrl =
    giveAsset && getAsset && giveAsset !== getAsset && debouncedRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${encodeURIComponent(giveAsset)}/${encodeURIComponent(getAsset)}/quote?quantity=${debouncedRaw}`
      : null;
  const {
    data: quote,
    error: quoteError,
    isValidating,
    mutate: mutateQuote,
  } = useSWR<Quote>(
    quoteUrl,
    (url: string) => fetchJson(url).then((d) => d.result),
    {
      refreshInterval: QUOTE_REFRESH_MS,
      onSuccess: () => setLastQuoteAt(Date.now()),
    },
  );

  const {
    balance: effBalance,
    pendingOutgoing,
    balanceError,
  } = useSpendableBalance(
    address,
    giveAsset,
    "swap",
  );

  // What the market holds of the buy asset — the pool reserve (the book
  // varies too fast to sum honestly client-side).
  const { data: poolInfo, error: poolError } = useSWR<{
    asset_a: string;
    asset_b: string;
    reserve_a: Raw;
    reserve_b: Raw;
  } | null>(
    giveAsset && getAsset && giveAsset !== getAsset
      ? [giveAsset, getAsset, "swap-pool-reserves"]
      : null,
    () =>
      fetchJson(
        `${COUNTERPARTY_API_BASE}/pools/${encodeURIComponent(giveAsset)}/${encodeURIComponent(getAsset)}`,
      )
        .then((d) => d.result ?? null)
        .catch((error: unknown) => {
          // Counterparty uses 404 for a pair with no pool. That is a normal
          // market state: the quote endpoint may still find resting orders.
          if (error instanceof Error && error.message === "HTTP 404") {
            return null;
          }
          throw error;
        }),
    { refreshInterval: 60_000 },
  );
  const poolHasLiquidity = Boolean(
    poolInfo &&
      approx(poolInfo.reserve_a) > 0 &&
      approx(poolInfo.reserve_b) > 0,
  );
  const availableRaw = poolInfo && poolHasLiquidity
    ? poolInfo.asset_a === getAsset
      ? poolInfo.reserve_a
      : poolInfo.asset_b === getAsset
        ? poolInfo.reserve_b
        : null
    : null;

  const staleQuote = isValidating || amountRaw !== debouncedRaw;
  const outRaw: Raw = quote && amountRaw > 0 ? quote.estimated_output : 0;
  const out = approx(outRaw) / SATS;
  const amountHuman = amountRaw / SATS;
  // The guarantee row, and the value consensus checks the fill against.
  const minReceivedRaw = reduceByPercent(outRaw, slippage);
  const impact = quote?.price_impact ?? 0;
  const insufficient =
    effBalance !== undefined && amountRaw > 0 && amountRaw > effBalance;
  const busy = isBusy(compose.status);

  // What this trade needs: another taker of the same size moves the price
  // by roughly this trade's own impact, so Auto tolerates that and no
  // more — floored at 0.5% (pool fee territory), capped at 5%.
  const neededSlippage =
    quote && approx(outRaw) > 0
      ? Math.min(5, Math.max(0.5, Math.ceil(impact * 10) / 10))
      : 1;
  useEffect(() => {
    setAutoValue(neededSlippage);
  }, [neededSlippage, setAutoValue]);

  useEffect(() => {
    if (compose.status === "confirmed") {
      const label =
        action === "buy"
          ? `Buy ${getAsset} — market order`
          : action === "sell"
            ? `Sell ${giveAsset} — market order`
            : `Swap ${giveAsset} for ${getAsset} — market order`;
      registerPending({
        txid: compose.txid,
        kind: "order",
        label,
        address: address ?? undefined,
        giveAsset,
        giveRaw: amountExact.toString(),
      });
    }
  }, [
    compose.status,
    compose.txid,
    action,
    giveAsset,
    getAsset,
    amountExact,
    address,
  ]);

  const ready =
    effBalance !== undefined &&
    amountRaw > 0 &&
    approx(outRaw) > 0 &&
    !busy &&
    !insufficient &&
    !staleQuote;

  // USD on BOTH sides, derived through the XCP leg of the trade.
  const xcpLeg =
    giveAsset === "XCP" ? amountHuman : getAsset === "XCP" ? out : null;
  const tradeUsd =
    xcpUsd !== null && xcpLeg !== null ? xcpLeg * xcpUsd : null;
  const giveUsd = tradeUsd;
  const getUsd = tradeUsd;

  // Reported here rather than alongside registerPending above, because the
  // trade's USD value isn't computed until this point. trackTx dedupes on the
  // txid, so this effect re-running as the rate refreshes costs nothing.
  useEffect(() => {
    if (compose.status === "confirmed") {
      trackTx(compose.txid, action, tradeUsd);
    }
  }, [compose.status, compose.txid, action, tradeUsd]);

  // Rate line: 1 <base> = <rate> <quote asset>, tap to invert.
  const rate = out > 0 && amountHuman > 0 ? out / amountHuman : null;
  const rateText =
    rate !== null
      ? rateInverted
        ? `1 ${getAsset} = ${formatPrice(1 / rate)} ${giveAsset}`
        : `1 ${giveAsset} = ${formatPrice(rate)} ${getAsset}`
      : null;
  const giveUnitUsd =
    rate !== null && xcpUsd
      ? giveAsset === "XCP"
        ? xcpUsd
        : getAsset === "XCP"
          ? rate * xcpUsd
          : null
      : null;
  const getUnitUsd =
    rate !== null && xcpUsd
      ? getAsset === "XCP"
        ? xcpUsd
        : giveAsset === "XCP"
          ? (1 / rate) * xcpUsd
          : null
      : null;
  const rateBaseUsd = rateInverted ? getUnitUsd : giveUnitUsd;

  const submit = async () => {
    if (!ready || !quote || !quoteUrl) return;
    let fresh = quote;
    try {
      fresh = (await fetchJson(quoteUrl)).result as Quote;
      mutateQuote(fresh, { revalidate: false });
      setLastQuoteAt(Date.now());
      if (ratio(fresh.estimated_output, quote.estimated_output) < 0.99) {
        setPriceMoved(true);
        return;
      }
    } catch {
      // fall back to the polled quote
    }
    setPriceMoved(false);
    compose.composeOrder({
      give_asset: giveAsset,
      give_quantity: amountExact,
      get_asset: getAsset,
      get_quantity: reduceByPercent(fresh.estimated_output, slippage),
      expiration,
      fee_rate: customFee > 0 ? customFee : undefined,
    });
  };

  const flip = () => {
    setFlips((f) => f + 1);
    if (out > 0) setAmount(fmtAmount(out));
    setGiveAsset(getAsset);
    setGetAsset(giveAsset);
    setRateInverted(false);
    setPriceMoved(false);
  };

  const chooseAsset = (nextAsset: string) => {
    if (!selectorLeg) return;
    const nextPair = selectTradeAsset(
      giveAsset,
      getAsset,
      selectorLeg,
      nextAsset,
    );
    setGiveAsset(nextPair.giveAsset);
    setGetAsset(nextPair.getAsset);
    setAmount("");
    setRateInverted(false);
    setPriceMoved(false);
  };

  // Each ticker independently edits the leg that was clicked. If the user
  // chooses the opposite leg's token, the pair flips instead of becoming an
  // impossible same-token swap. Compact asset-page cards remain fixed.
  const chipFor = (a: string, leg: TradePairLeg) =>
    compact ? (
      <AssetChip asset={a} />
    ) : (
      <AssetChip asset={a} onClick={() => setSelectorLeg(leg)} />
    );

  // Presets live in the label row in both layouts, always visible while
  // connected — compact cards should not turn a primary control into a hover
  // interaction. The balance keeps the footer's bottom-right corner as a
  // click-to-fill.
  const presetRow = effBalance !== undefined && effBalance > 0n && (
    <span className="flex items-center gap-1">
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() =>
            setAmount(fmtAmount(approx(percentOf(effBalance, p)) / SATS))
          }
          className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
        >
          {p === 100 ? "Max" : `${p}%`}
        </button>
      ))}
    </span>
  );

  // "Available: X" mirrors the balance grammar; whole numbers up to a
  // million, then compact (22.5M) — depth, not a digit-counting exercise.
  const availableUnits =
    availableRaw !== null ? Math.round(approx(availableRaw) / SATS) : null;
  const availableLabel = availableUnits !== null && (
    <span>
      Available:{" "}
      {availableUnits >= 1e6
        ? compactFmt(availableUnits)
        : availableUnits.toLocaleString("en-US")}
    </span>
  );

  const balanceLabel = effBalance !== undefined && (
    <button
      type="button"
      className="min-w-0 truncate text-gray-500 hover:text-purple-600"
      onClick={() => setAmount(fmtAmount(approx(effBalance) / SATS))}
    >
      Balance: {commasRaw(effBalance)}
      {pendingOutgoing > 0n && (
        <span className="text-gray-400">
          {" "}
          · {commasRaw(pendingOutgoing)} pending
        </span>
      )}
    </button>
  );

  const buttonLabel = busy
    ? compose.status === "composing"
      ? "Composing…"
      : compose.status === "signing"
        ? "Confirm in wallet…"
        : "Broadcasting…"
    : amountRaw === 0
      ? "Enter an amount"
      : effBalance === undefined
        ? balanceError
          ? "Balance unavailable"
          : "Checking balance…"
      : insufficient
        ? `Insufficient ${giveAsset} balance`
        : approx(outRaw) === 0
          ? staleQuote
            ? "Fetching quote…"
            : quoteError
              ? !poolHasLiquidity
                ? "No quote for this pair"
                : "Quote unavailable"
            : availableRaw !== null
              ? "Amount too small — rounds to 0"
              : "No quote for this pair"
          : slippage >= 20
            ? `${actionLabel} anyway — ${slippage}% slippage`
            : impact >= 5
              ? `${actionLabel} anyway`
              : action === "buy"
                ? `Buy ${getAsset}`
                : action === "sell"
                  ? `Sell ${giveAsset}`
                  : `Swap ${giveAsset} for ${getAsset}`;

  // The live slippage figure in the buy-well corner; the gear that edits
  // it sits beside the mode tabs (the Uniswap placement). Auto is marked.
  const slippageControl = (
    <span
      className={
        !slippageAuto && customSlip > 0
          ? "font-medium text-purple-600"
          : "text-gray-500"
      }
    >
      Slippage: {slippage}%
      {slippageAuto && <span className="text-gray-400"> · auto</span>}
    </span>
  );

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* In compact rails, balance/slippage sit with the asset chip. That keeps
          the footer about value only and matches the wide form's right edge. */}
      <Well
        focusable
        layout={compact ? "stack" : "row"}
        label="Sell"
        topRight={presetRow || undefined}
        chip={chipFor(giveAsset, "give")}
        chipRight={compact ? balanceLabel : undefined}
        footer={
          compact ? (
            <span>
              {giveUsd === null ? "USD unavailable" : `≈ ${usdFmt(giveUsd)}`}
            </span>
          ) : (
            <>
              <span>
                {giveUsd === null ? "USD unavailable" : `≈ ${usdFmt(giveUsd)}`}
              </span>
              {balanceLabel}
            </>
          )
        }
      >
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
      </Well>

      <FlipNotch onFlip={flip} flips={flips} />

      {/* Buy well */}
      <Well
        layout={compact ? "stack" : "row"}
        label="Buy"
        topRight={availableLabel || undefined}
        chip={chipFor(getAsset, "get")}
        chipRight={compact ? slippageControl : undefined}
        footer={
          compact ? (
            <span>
              {getUsd === null ? "USD unavailable" : `≈ ${usdFmt(getUsd)}`}
            </span>
          ) : (
            <>
              <span>
                {getUsd === null ? "USD unavailable" : `≈ ${usdFmt(getUsd)}`}
              </span>
              {slippageControl}
            </>
          )
        }
      >
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
          {approx(outRaw) > 0 ? commasRaw(outRaw) : "0"}
        </div>
      </Well>

      {/* Rate line — price impact named and signed beside the quote ring,
          gray until it matters. The receipt below is always open once a
          quote is live: no toggle to hunt for, and Min received is the
          guarantee row, digit-for-digit what the wallet will show. */}
      {rateText && (
      <div className="px-2 pt-2">
        <div className="flex h-6 items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setRateInverted((v) => !v)}
            aria-label="Invert rate"
            className="text-gray-600 hover:text-gray-900"
          >
            {rateText}
            {rateBaseUsd !== null && (
              <span className="text-gray-400"> ({usdFmt(rateBaseUsd)})</span>
            )}
          </button>
          <span className="flex items-center gap-2">
            {approx(outRaw) > 0 && (
              <span
                className={
                  impact >= 5
                    ? "font-medium text-red-600"
                    : impact >= 3
                      ? "font-medium text-amber-600"
                      : "text-gray-400"
                }
              >
                Price impact {impact.toFixed(1)}%
              </span>
            )}
            {rateText && (
              <QuoteRing
                periodMs={QUOTE_REFRESH_MS}
                lastUpdated={lastQuoteAt}
                fetching={staleQuote}
              />
            )}
          </span>
        </div>
        {quote && approx(outRaw) > 0 && (
          <dl className="mt-1 space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <dt>Min received</dt>
              <dd className="font-medium tabular-nums text-gray-700">
                {commasRaw(minReceivedRaw)} {getAsset}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Route</dt>
              <dd>
                {approx(quote.pool_output) > 0 && approx(quote.book_output) > 0
                  ? "Pool + order book"
                  : approx(quote.pool_output) > 0
                    ? "Pool"
                    : "Order book"}
              </dd>
            </div>
            {quote.fee_bps !== undefined && approx(quote.pool_output) > 0 && (
              <div className="flex justify-between">
                <dt>LP fee</dt>
                <dd>{(quote.fee_bps / 100).toFixed(2)}%</dd>
              </div>
            )}
            {feeRate !== null && (
              <div className="flex justify-between">
                <dt>TX fee</dt>
                <dd className={customFee > 0 ? "font-medium text-purple-600" : ""}>
                  {satsPerVb(feeRate)} sat/vB
                  {btcUsd != null && (
                    <span className="text-gray-400">
                      {" "}
                      (~{usdFmt(((feeRate * ORDER_VBYTES) / SATS) * btcUsd)})
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
      )}

      <div className="px-0.5 pb-0.5 pt-3">
        {poolInfo !== undefined && !poolHasLiquidity && !poolError && (
          <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No active {giveAsset}/{getAsset} pool liquidity. A resting order
            can still fill through the order book.
          </p>
        )}

        {poolError && (
          <p className="mb-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Couldn&apos;t check the {giveAsset}/{getAsset} pool. Quotes may still
            use the order book.
          </p>
        )}

        {priceMoved && (
          <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Quote moved — the numbers above are updated. Press again to swap
            at the new price.
          </p>
        )}

        {compose.status === "error" && (
          <ErrorBanner className="mb-2" onDismiss={compose.reset}>{compose.error}</ErrorBanner>
        )}

        {walletStatus !== "connected" ? (
          <ConnectButton />
        ) : (
          <CTA
            disabled={!ready}
            onClick={submit}
            variant={(impact >= 5 || slippage >= 20) && ready ? "danger" : "primary"}
          >
            {buttonLabel}
          </CTA>
        )}
        {compose.status === "confirmed" && (
          <div className="mt-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800">
                Swap broadcast — <TxLink txid={compose.txid} />
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

      {!compact && (
        <TokenSelectModal
          open={selectorLeg !== null}
          onClose={() => setSelectorLeg(null)}
          assets={selectableAssets}
          selected={selectorLeg === "give" ? giveAsset : getAsset}
          address={address}
          title={selectorLeg === "give" ? "Choose what to sell" : "Choose what to buy"}
          onSelect={chooseAsset}
        />
      )}
    </div>
  );
}
