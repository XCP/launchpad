"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { AssetChip, XcpChip } from "@/components/asset-chip";
import { ConnectButton } from "@/components/connect-button";
import { OrderTracker } from "@/components/order-tracker";
import { QuoteRing } from "@/components/quote-ring";
import { TokenSelectModal } from "@/components/token-select-modal";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { FlipNotch } from "@/components/ui/flip-notch";
import { GearPopover } from "@/components/ui/popover";
import { Well } from "@/components/ui/well";
import { fetchBalance, fetchJson } from "@/lib/client";
import { commas, price as formatPrice, usd as usdFmt } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import {
  pendingSpentRaw,
  readPending,
  readPendingServer,
  registerPending,
  subscribePending,
} from "@/lib/pending";
import { isBusy } from "@/lib/use-busy";
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
  const [asset, setAsset] = useState(assets[0] ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippagePreset, setSlippagePreset] = useState(1);
  const [customSlippage, setCustomSlippage] = useState("");
  const [customExpiration, setCustomExpiration] = useState("");
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

  // Mempool-aware balance: subtract what unresolved pending actions spend.
  // The pending list is part of the balance key, so any resolution
  // triggers an immediate refetch — no unsynchronized-poller wobble.
  const pendingItems = useSyncExternalStore(
    subscribePending,
    readPending,
    readPendingServer,
  );
  const resolvedCount = pendingItems.filter((i) => i.resolved).length;
  const { data: balance } = useSWR(
    address && giveAsset
      ? [address, giveAsset, "swap-balance", resolvedCount]
      : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );
  const effBalance =
    balance !== undefined
      ? Math.max(0, balance - pendingSpentRaw(giveAsset))
      : undefined;

  // What the market holds of the buy asset — the pool reserve (the book
  // varies too fast to sum honestly client-side).
  const { data: poolInfo } = useSWR<{
    asset_a: string;
    reserve_a: number;
    reserve_b: number;
  } | null>(
    asset ? [asset, "swap-pool-reserves"] : null,
    () =>
      fetchJson(`${COUNTERPARTY_API_BASE}/pools/${asset}/XCP`)
        .then((d) => d.result ?? null)
        .catch(() => null),
    { refreshInterval: 60_000 },
  );
  const availableRaw = poolInfo
    ? getAsset === "XCP"
      ? poolInfo.asset_a === "XCP"
        ? poolInfo.reserve_a
        : poolInfo.reserve_b
      : poolInfo.asset_a === "XCP"
        ? poolInfo.reserve_b
        : poolInfo.reserve_a
    : null;

  const staleQuote = isValidating || amountRaw !== debouncedRaw;
  const outRaw = quote && amountRaw > 0 ? quote.estimated_output : 0;
  const out = outRaw / SATS;
  const amountHuman = amountRaw / SATS;
  const minReceivedRaw = Math.floor(outRaw * (1 - slippage / 100));
  const impact = quote?.price_impact ?? 0;
  const insufficient =
    effBalance !== undefined && amountRaw > 0 && amountRaw > effBalance;
  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "confirmed") {
      registerPending({
        txid: compose.txid,
        kind: "order",
        label: `${side === "buy" ? "Buy" : "Sell"} ${asset} — market order`,
        giveAsset,
        giveRaw: amountRaw,
      });
    }
  }, [compose.status, compose.txid, side, asset, giveAsset, amountRaw]);

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

  // On a single-asset surface (the asset page) the chip is identity, not a
  // control — no chevron, no modal.
  const tokenChip =
    assets.length === 1 ? (
      <AssetChip asset={asset} />
    ) : (
      <AssetChip asset={asset} onClick={() => setSelectorOpen(true)} />
    );

  const balanceControls = effBalance !== undefined && (
    <>
      <button
        type="button"
        className="group-focus-within:hidden group-hover:hidden"
        onClick={() => setAmount(fmtAmount(effBalance / SATS))}
      >
        Balance: {commas(effBalance / SATS)}
        {balance !== undefined && balance > effBalance && (
          <span className="text-gray-400">
            {" "}
            · {commas((balance - effBalance) / SATS)} pending
          </span>
        )}
      </button>
      <span className="hidden items-center gap-1 group-focus-within:flex group-hover:flex">
        {effBalance > 0 ? (
          PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                setAmount(fmtAmount(Math.floor((effBalance * p) / 100) / SATS))
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
      <div className="flex items-center justify-end px-2 pb-1 pt-0.5">
        <GearPopover
          active={customSlip > 0 || expiration !== MARKET_EXPIRATION}
          label="Swap settings"
        >
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
            <span className="text-xs font-medium text-gray-500">Expiration</span>
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
            {MARKET_EXPIRATION} = fill at confirmation or refund next block.
          </p>
          <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
            Min received is enforced by the order itself — worse fills are
            impossible; better ones refund the difference.
          </div>
        </GearPopover>
      </div>

      {/* Sell well — inset follows focus; balance row swaps to presets on hover */}
      <Well
        focusable
        layout={compact ? "stack" : "row"}
        label="Sell"
        chipRight={
          compact && effBalance !== undefined ? balanceControls : undefined
        }
        chip={giveAsset === "XCP" ? <XcpChip /> : tokenChip}
        footer={
          <>
            <span>≈ {usdFmt(giveUsd ?? 0)}</span>
            {!compact && effBalance !== undefined && (
              <span className="flex min-w-0 items-center gap-1 text-gray-500">
                {balanceControls}
              </span>
            )}
          </>
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
        chip={getAsset === "XCP" ? <XcpChip /> : tokenChip}
        chipRight={
          compact && availableRaw !== null ? (
            <span>{commas(availableRaw / SATS)} in pool</span>
          ) : undefined
        }
        footer={
          <>
            <span>≈ {usdFmt(getUsd ?? 0)}</span>
            {!compact && availableRaw !== null && (
              <span className="text-gray-500">
                {commas(availableRaw / SATS)} in pool
              </span>
            )}
          </>
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
          {out > 0 ? commas(out) : "0"}
        </div>
      </Well>

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
          <ErrorBanner className="mb-2">{compose.error}</ErrorBanner>
        )}

        {walletStatus !== "connected" ? (
          <ConnectButton />
        ) : (
          <CTA
            disabled={!ready}
            onClick={submit}
            variant={impact >= 5 && ready ? "danger" : "primary"}
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
        {ready && minReceivedRaw > 0 && (
          <div className="mt-1.5 px-1.5 text-[11px]">
            <div className="flex items-center justify-between text-gray-600">
              <span>You receive at least</span>
              <span className="font-medium tabular-nums">
                {(minReceivedRaw / SATS).toFixed(8)} {getAsset}
              </span>
            </div>
            <p className="mt-0.5 text-gray-400">
              Your wallet will show this exact guaranteed minimum. If the
              pool can&apos;t deliver at least this much, the transaction
              fails and you keep your {giveAsset}.
            </p>
          </div>
        )}
      </div>

      {assets.length > 1 && (
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
      )}
    </div>
  );
}
