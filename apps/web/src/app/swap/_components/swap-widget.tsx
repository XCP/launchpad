"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { AssetChip } from "@/components/asset-chip";
import { ConnectButton } from "@/components/connect-button";
import { OrderTracker } from "@/components/order-tracker";
import { QuoteRing } from "@/components/quote-ring";
import { TokenSelectModal } from "@/components/token-select-modal";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { BalanceUnavailable } from "@/components/ui/balance-unavailable";
import { ErrorBanner } from "@/components/ui/error-banner";
import { FlipNotch } from "@/components/ui/flip-notch";
import { Well } from "@/components/ui/well";
import { fetchBtcUsd } from "@/lib/api/price-client";
import { fetchJson } from "@/lib/client";
import { commasRaw, compact as compactFmt, price as formatPrice, satsPerVb } from "@/lib/format";
import { useFiat, useFxRate } from "@/lib/currency";
import {
  approx,
  big,
  parseUnitsToRaw,
  percentOf,
  type Raw,
  ratio,
  reduceByPercent,
  SATS,
} from "@/lib/numeric";
import {
  type BookOrder as SimBookOrder,
  OTHER_POOL_FEE_BPS,
  quoteAfterMempool,
  registerPending,
  XCP_POOL_FEE_BPS,
} from "@xcp/wallet-sdk";
import { useDebounced } from "@/hooks/use-debounced";
import { useMempool } from "@/hooks/use-mempool";
import { trackTx } from "@/lib/analytics";
import { useSpendableBalance } from "@xcp/wallet-sdk/react/use-spendable-balance";
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

/** A resting order as `/orders/{a}/{b}` returns it, the fields the replay needs. */
interface CpBookOrder {
  give_asset: string;
  get_asset: string;
  give_quantity: Raw;
  get_quantity: Raw;
  give_remaining: Raw;
  get_remaining: Raw;
}

/** Auto slippage's ceiling when nothing is pending: this trade's own impact
 *  is the only thing it has to allow for. */
const AUTO_SLIPPAGE_CAP = 5;
/** ...and with the mempool counted, how far Auto may follow it. Past this the
 *  trade is not a market order any more, and the button says so. */
const AUTO_SLIPPAGE_MEMPOOL_CAP = 20;

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
  const usdFmt = useFiat();
  const { code } = useFxRate();
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
    balanceUnavailable,
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

  // What is already in line ahead of this trade.
  //
  // Core's quote reflects the confirmed state only, and says so — "actual
  // execution may differ if trades confirm before yours." Those trades are
  // not a mystery: the pending orders on a pair are public, and the header
  // chip already polls them under this same key. A market order priced off
  // the confirmed quote with slippage that ignores them misses its price
  // when they land first, and rests for a block instead of filling. So the
  // pending same-direction orders are replayed through Core's own quote
  // algorithm (see lib/pool-quote) ahead of this one, and what they leave
  // is what Auto slippage has to cover.
  const { orders: mempoolOrders } = useMempool(30_000);
  const pendingAhead = useMemo(
    () =>
      giveAsset && getAsset && giveAsset !== getAsset
        ? mempoolOrders
            .filter((o) => o.giveAsset === giveAsset && o.getAsset === getAsset)
            .map((o) => big(o.giveQuantity))
        : [],
    [mempoolOrders, giveAsset, getAsset],
  );
  // The resting book exists here only to be replayed through, so it is
  // fetched only while there is something pending to replay.
  const { data: restingBook, error: restingBookError } = useSWR<SimBookOrder[]>(
    pendingAhead.length > 0 ? [giveAsset, getAsset, "swap-resting-book"] : null,
    () =>
      fetchJson(
        `${COUNTERPARTY_API_BASE}/orders/${encodeURIComponent(getAsset)}/${encodeURIComponent(giveAsset)}?status=open&limit=1000`,
      ).then((d) =>
        ((d.result ?? []) as CpBookOrder[])
          .filter((o) => o.give_asset === getAsset && o.get_asset === giveAsset)
          .map((o) => ({
            giveQuantity: big(o.give_quantity),
            getQuantity: big(o.get_quantity),
            giveRemaining: big(o.give_remaining),
            getRemaining: big(o.get_remaining),
          })),
      ),
    { refreshInterval: 60_000 },
  );

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

  // The quote once the pending orders have gone first, as a fraction of the
  // quote against the confirmed state. Null while the inputs are loading or
  // when nothing is pending. A book that failed to load counts as empty:
  // the pool then absorbs every pending order, which overstates the drop,
  // and overstating is the safe direction for a tolerance.
  const mempoolQuote = useMemo(() => {
    if (pendingAhead.length === 0 || amountExact <= 0n) return null;
    if (poolInfo === undefined) return null;
    const book = restingBook ?? (restingBookError ? [] : undefined);
    if (book === undefined) return null;
    const pool =
      poolInfo && poolHasLiquidity
        ? {
            reserveIn: big(poolInfo.asset_a === giveAsset ? poolInfo.reserve_a : poolInfo.reserve_b),
            reserveOut: big(poolInfo.asset_a === giveAsset ? poolInfo.reserve_b : poolInfo.reserve_a),
            feeBps:
              quote?.fee_bps ??
              (giveAsset === "XCP" || getAsset === "XCP" ? XCP_POOL_FEE_BPS : OTHER_POOL_FEE_BPS),
          }
        : null;
    if (!pool && book.length === 0) return null;
    return quoteAfterMempool({ pool, book }, pendingAhead, amountExact);
  }, [
    pendingAhead,
    amountExact,
    poolInfo,
    poolHasLiquidity,
    restingBook,
    restingBookError,
    giveAsset,
    getAsset,
    quote?.fee_bps,
  ]);
  const mempoolDrop = mempoolQuote?.dropPercent ?? 0;
  // Core's quote, scaled by what the replay says the mempool leaves of it.
  // Scaled rather than used directly so any drift between the port and the
  // node cancels out: the number the user sees stays anchored to Core's.
  const afterMempoolRaw =
    mempoolQuote && mempoolQuote.baseline > 0n && approx(outRaw) > 0
      ? (big(outRaw) * mempoolQuote.output) / mempoolQuote.baseline
      : null;
  // The guarantee row is below what the mempool leaves: this order, as
  // priced, rests instead of filling if the pending ones confirm first.
  const minBelowMempool = afterMempoolRaw !== null && minReceivedRaw > afterMempoolRaw;

  // What this trade needs: whatever is already pending ahead of it, plus
  // room for one more taker of this size — which moves the price by roughly
  // this trade's own impact. Floored at 0.5% (pool fee territory). The
  // impact share is capped as it always was; the mempool share is allowed
  // through, because it is not a guess, up to the point where the button
  // stops calling this a market order.
  const neededSlippage =
    quote && approx(outRaw) > 0
      ? Math.min(
          AUTO_SLIPPAGE_MEMPOOL_CAP,
          Math.max(
            0.5,
            Math.ceil((Math.min(impact, AUTO_SLIPPAGE_CAP) + mempoolDrop) * 10) / 10,
          ),
        )
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
        spends: [{ asset: giveAsset, raw: amountExact.toString() }],
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

  // A failed balance read does not hold the trade — see useSpendableBalance's
  // balanceUnavailable. Only a read still in flight does, and briefly.
  const balanceSettled = effBalance !== undefined || balanceUnavailable;
  const ready =
    balanceSettled &&
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
          className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95"
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

  const balanceLabel = effBalance === undefined ? (
    <BalanceUnavailable error={balanceError} />
  ) : (
    <button
      type="button"
      className="min-w-0 truncate text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
      onClick={() => setAmount(fmtAmount(approx(effBalance) / SATS))}
    >
      Balance: {commasRaw(effBalance)}
      {pendingOutgoing > 0n && (
        <span className="text-gray-400 dark:text-gray-500">
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
      : !balanceSettled
        ? "Checking balance…"
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
          ? "font-medium text-purple-600 dark:text-purple-400"
          : "text-gray-500 dark:text-gray-400"
      }
    >
      Slippage: {slippage}%
      {slippageAuto && <span className="text-gray-400 dark:text-gray-500"> · auto</span>}
    </span>
  );

  return (
    <div className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2">
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
              {giveUsd === null ? `${code} unavailable` : `≈ ${usdFmt(giveUsd)}`}
            </span>
          ) : (
            <>
              <span>
                {giveUsd === null ? `${code} unavailable` : `≈ ${usdFmt(giveUsd)}`}
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
          className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600 ${
            insufficient ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
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
              {getUsd === null ? `${code} unavailable` : `≈ ${usdFmt(getUsd)}`}
            </span>
          ) : (
            <>
              <span>
                {getUsd === null ? `${code} unavailable` : `≈ ${usdFmt(getUsd)}`}
              </span>
              {slippageControl}
            </>
          )
        }
      >
        <div
          className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
            out > 0 ? "text-gray-900 dark:text-gray-100" : "text-gray-300 dark:text-gray-600"
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
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          >
            {rateText}
            {rateBaseUsd !== null && (
              <span className="text-gray-400 dark:text-gray-500"> ({usdFmt(rateBaseUsd)})</span>
            )}
          </button>
          <span className="flex items-center gap-2">
            {approx(outRaw) > 0 && (
              <span
                className={
                  impact >= 5
                    ? "font-medium text-red-600 dark:text-red-400"
                    : impact >= 3
                      ? "font-medium text-amber-600 dark:text-amber-400"
                      : "text-gray-400 dark:text-gray-500"
                }
              >
                Price impact {impact.toFixed(1)}%
              </span>
            )}
            {mempoolQuote && (
              <span
                className={
                  mempoolDrop >= 3
                    ? "font-medium text-amber-600 dark:text-amber-400"
                    : "text-gray-400 dark:text-gray-500"
                }
                title={`${mempoolQuote.pendingCount} unconfirmed ${mempoolQuote.pendingCount === 1 ? "order" : "orders"} on this pair in the same direction. If they confirm first, this trade gets about ${mempoolDrop.toFixed(1)}% less than the quote. Auto slippage allows for it.`}
              >
                {mempoolQuote.pendingCount} ahead in mempool
                {mempoolDrop > 0 && ` · −${mempoolDrop.toFixed(1)}%`}
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
          <dl className="mt-1 space-y-1.5 border-t border-gray-100 dark:border-gray-800 pt-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-between">
              <dt>Min received</dt>
              <dd
                className={`font-medium tabular-nums ${
                  minBelowMempool
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-700 dark:text-gray-300"
                }`}
                title={
                  minBelowMempool
                    ? "Above what the pending orders would leave. If they confirm first, this order rests for a block and refunds instead of filling — raise the slippage or use Auto."
                    : undefined
                }
              >
                {commasRaw(minReceivedRaw)} {getAsset}
                {minBelowMempool && (
                  <span className="font-normal"> · above the mempool estimate</span>
                )}
              </dd>
            </div>
            {afterMempoolRaw !== null && (
              <div className="flex justify-between">
                <dt>After mempool</dt>
                <dd className="tabular-nums">
                  ≈ {commasRaw(afterMempoolRaw)} {getAsset}
                </dd>
              </div>
            )}
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
                <dd className={customFee > 0 ? "font-medium text-purple-600 dark:text-purple-400" : ""}>
                  {satsPerVb(feeRate)} sat/vB
                  {btcUsd != null && (
                    <span className="text-gray-400 dark:text-gray-500">
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
          <p className="mb-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            No active {giveAsset}/{getAsset} pool liquidity. A resting order
            can still fill through the order book.
          </p>
        )}

        {poolError && (
          <p className="mb-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
            Couldn&apos;t check the {giveAsset}/{getAsset} pool. Quotes may still
            use the order book.
          </p>
        )}

        {priceMoved && (
          <p className="mb-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
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
          <div className="mt-2 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800 dark:text-green-300">
                Swap broadcast — <TxLink txid={compose.txid} />
              </span>
              <button
                type="button"
                onClick={compose.reset}
                className="text-xs text-green-800 dark:text-green-300 underline"
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
