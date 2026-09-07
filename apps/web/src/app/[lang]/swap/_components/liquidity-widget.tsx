"use client";

import { ComposeError } from "@/components/compose-error";

import { parseRawInteger, rawToInput } from "@xcp/wallet-sdk/amounts";
import { parseAmountRaw } from "@/lib/amount-draft";
import { validateDepositQuote, validateWithdrawQuote, type DepositQuote, type WithdrawQuote } from "@/lib/quote-validation";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { AssetChip } from "@/components/asset-chip";
import { TokenSelectModal } from "@/components/token-select-modal";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { BalanceUnavailable } from "@/components/ui/balance-unavailable";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Well } from "@/components/ui/well";
import { fetchBtcUsd } from "@/lib/api/price-client";
import { useFiat } from "@/lib/currency";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { rich } from "@/lib/i18n/rich";
import {
  approx,
  big,
  maxRaw,
  minRaw,
  percentOf,
  type Raw,
  ratio,
  reduceByPercent,
  SATS,
} from "@/lib/numeric";
import { useDebounced } from "@/hooks/use-debounced";
import { trackTx } from "@/lib/analytics";
import { registerPending } from "@xcp/wallet-sdk";
import { useSpendableBalance } from "@xcp/wallet-sdk/react/use-spendable-balance";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { useSwapSettings } from "@/app/[lang]/swap/_components/swap-settings";
import { defaultTradeAsset } from "@/lib/trade-selection";

/** Pool tx size for the TX-fee estimate; true size known after compose. */
const POOL_VBYTES = 250;
const PRESETS = [25, 50, 75, 100] as const;

interface PoolInfo {
  asset_a: string;
  asset_b: string;
  reserve_a: Raw;
  reserve_b: Raw;
  lp_asset: string;
}

/**
 * Liquidity on top of the locked floor: the launch LP is burned forever;
 * anything YOU add mints LP to your address, earns the 50 bps swap fee,
 * and withdraws whenever you like. Same grammar as the swap card: wells
 * with corner labels, an always-open receipt, settings in the tab-row gear.
 */
export function LiquidityWidget({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const num = useNumbers();
  const t = useT();
  const usdFmt = useFiat();
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const submittedTrade = useRef<{
    pending: Omit<Parameters<typeof registerPending>[0], "txid">;
    action: string;
    usd: number | null;
  } | null>(null);
  const [asset, setAsset] = useState(() => defaultTradeAsset(assets));
  const [tab, setTab] = useState<"add" | "remove">("add");
  const [submittedAction, setSubmittedAction] = useState<"add" | "remove" | null>(null);
  // Bidirectional add: edit either leg and the other derives at the pool
  // ratio — consensus clamps every deposit to the current ratio, so you
  // don't get to pick one (if you don't like the price, place an order).
  const [tokenAmount, setTokenAmount] = useState("");
  const [xcpAmount, setXcpAmount] = useState("");
  const [editSide, setEditSide] = useState<"token" | "xcp">("token");
  const [rateInverted, setRateInverted] = useState(false);
  const [pct, setPct] = useState(25); // remove tab
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [quoteRefreshError, setQuoteRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { lqSlippage, customFee, medianFeeRate, liquiditySettingsValid } = useSwapSettings();
  const feeRate = customFee ?? medianFeeRate ?? null;
  const { data: btcUsd } = useSWR(
    "btc-usd",
    fetchBtcUsd,
    { refreshInterval: 60_000 },
  );

  const { data: pool } = useSWR<PoolInfo | null>(
    asset ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP` : null,
    (url: string) => fetchJson(url).then((d) => d.result ?? null),
    { refreshInterval: 30_000 },
  );

  const amount = editSide === "token" ? tokenAmount : xcpAmount;
  // Quotes and compose retain raw integers; doubles are display only.
  const amountExact = parseAmountRaw(amount) ?? 0n;
  const amountRaw = approx(amountExact);
  const debouncedRaw = useDebounced(amountExact.toString(), 250);
  // The quote's `quantity` is the FIRST asset in the URL path (verified in
  // counterparty-core queries.get_pool_quote_deposit) — flip the pair to
  // quote by whichever side is being edited. Response assets are canonical.
  const depositUrl = tab === "add" && liquiditySettingsValid && asset && amountExact > 0n && amountExact.toString() === debouncedRaw
      ? `${COUNTERPARTY_API_BASE}/pools/${
          editSide === "token" ? `${asset}/XCP` : `XCP/${asset}`
        }/quote/deposit?quantity=${debouncedRaw}`
      : null;
  const { data: depositQuote, isValidating: depFetching, mutate: mutateDeposit } = useSWR<DepositQuote>(
    depositUrl,
    (url: string) => fetchJson(url).then((d) => validateDepositQuote(d.result,
      editSide === "token" ? asset : "XCP", editSide === "token" ? "XCP" : asset, BigInt(debouncedRaw))),
    { refreshInterval: 60_000 },
  );
  const depStale = depFetching || amountExact.toString() !== debouncedRaw;
  const depTokenRaw: Raw = depositQuote
    ? (depositQuote.asset_a === asset
        ? depositQuote.quantity_a_required
        : depositQuote.quantity_b_required) ?? 0
    : 0;
  const depXcpRaw: Raw = depositQuote
    ? (depositQuote.asset_a === "XCP"
        ? depositQuote.quantity_a_required
        : depositQuote.quantity_b_required) ?? 0
    : 0;
  // Doubles for the readiness checks and the USD line; the exact values above
  // are what gets deposited.
  const depTokenNum = approx(depTokenRaw);
  const depXcpNum = approx(depXcpRaw);

  const {
    balance: tokenBalance,
    balanceError: tokenBalanceError,
    balanceUnavailable: tokenBalanceUnavailable,
  } = useSpendableBalance(address, asset, "liquidity-token");
  const {
    balance: xcpBalance,
    balanceError: xcpBalanceError,
    balanceUnavailable: xcpBalanceUnavailable,
  } = useSpendableBalance(address, "XCP", "liquidity-xcp");

  // Congestion-priced XCP gas for pool ops — usually 0, but never hardcode.
  const { data: gasFee } = useSWR<bigint>(
    address
      ? `${COUNTERPARTY_API_BASE}/addresses/${address}/compose/${
          tab === "add" ? "pooldeposit" : "poolwithdraw"
        }/estimatexcpfees`
      : null,
    (url: string) => fetchJson(url).then((d) => parseRawInteger(d.result)),
    { refreshInterval: 60_000 },
  );

  const { balance: lpBalance, balanceError: lpBalanceError } = useSpendableBalance(
    address,
    pool?.lp_asset ?? null,
    "liquidity-lp",
  );

  // LP supply + reserves in one request (a withdraw quote for 1 LP unit) —
  // the cheapest supply source; powers pool share and your-position rows.
  const { data: poolMeta } = useSWR<WithdrawQuote>(
    asset && pool
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/withdraw?quantity=1`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 60_000 },
  );
  const lpSupply = big(poolMeta?.supply);
  const reserveToken = big(
    pool ? (pool.asset_a === asset ? pool.reserve_a : pool.reserve_b) : 0,
  );
  const reserveXcp = big(
    pool ? (pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b) : 0,
  );
  // Spot rate from reserves — no endpoint computes it (verified in source).
  // A rate, so a double, from an exact division.
  const spotRate = reserveToken > 0n ? ratio(reserveXcp, reserveToken) : null;
  // The largest deposit you can actually make: bounded by BOTH balances
  // through the pool ratio (the XCP leg must also cover any protocol gas).
  // Presets mean "% of what you can do", not "% of one balance".
  const maxDepositRaw =
    reserveXcp > 0n
      ? minRaw(
          big(tokenBalance ?? 0),
          (maxRaw(0n, big(xcpBalance ?? 0) - big(gasFee ?? 0)) * reserveToken) /
            reserveXcp,
        )
      : big(tokenBalance ?? 0);
  // A share of the pool. The "%" is ours rather than a translation's, so it
  // goes through `num.percent` with the number — French and Russian space it
  // off. `x` arrives already multiplied out, so it goes back to a ratio.
  const pctFmt = (x: number) =>
    x >= 100
      ? num.percent(1, { digits: 0 })
      : x >= 0.01
        ? num.percent(x / 100, { digits: 2, minDigits: 2 })
        : `<${num.percent(0.01 / 100, { digits: 2, minDigits: 2 })}`;
  const lpToRemove = percentOf(lpBalance ?? 0, pct);
  const debouncedLp = useDebounced(lpToRemove.toString(), 250);

  const withdrawalUrl = tab === "remove" && liquiditySettingsValid && asset && lpToRemove > 0n && lpToRemove.toString() === debouncedLp
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/withdraw?quantity=${debouncedLp}`
      : null;
  const { data: withdrawQuote, isValidating: withdrawalFetching } = useSWR<WithdrawQuote>(
    withdrawalUrl,
    (url: string) => fetchJson(url).then((d) => validateWithdrawQuote(d.result, asset, "XCP", BigInt(debouncedLp))),
    { refreshInterval: 60_000 },
  );
  const outTokenRaw: Raw = withdrawQuote
    ? (withdrawQuote.asset_a === asset
        ? withdrawQuote.quantity_a_estimate
        : withdrawQuote.quantity_b_estimate) ?? 0
    : 0;
  const outXcpRaw: Raw = withdrawQuote
    ? (withdrawQuote.asset_a === "XCP"
        ? withdrawQuote.quantity_a_estimate
        : withdrawQuote.quantity_b_estimate) ?? 0
    : 0;

  const busy = isBusy(compose.status) || refreshing;

  useEffect(() => {
    if (compose.status === "error") submittedTrade.current = null;
    if (compose.status === "confirmed" && submittedTrade.current) {
      const submitted = submittedTrade.current;
      submittedTrade.current = null;
      registerPending({ ...submitted.pending, txid: compose.txid });
      trackTx(compose.txid, submitted.action, submitted.usd);
    }
  }, [compose.status, compose.txid]);

  const needTokenRaw = editSide === "token" ? amountExact : big(depTokenRaw);
  const insufficientToken =
    tokenBalance !== undefined &&
    needTokenRaw > 0 &&
    needTokenRaw > tokenBalance;
  // The XCP leg must cover the deposit plus any XCP gas fee.
  const insufficientXcp =
    xcpBalance !== undefined &&
    depXcpNum > 0 &&
    big(depXcpRaw) + big(gasFee ?? 0) > xcpBalance;

  // Failed balance reads do not hold the deposit — see useSpendableBalance's
  // balanceUnavailable. Only a read still in flight does, and briefly.
  const balancesSettled =
    (tokenBalance !== undefined || tokenBalanceUnavailable) &&
    (xcpBalance !== undefined || xcpBalanceUnavailable);
  const addReady =
    liquiditySettingsValid && gasFee !== undefined && !depStale &&
    tab === "add" &&
    amountRaw > 0 &&
    depTokenNum > 0 &&
    depXcpNum > 0 &&
    balancesSettled &&
    !busy &&
    !insufficientToken &&
    !insufficientXcp &&
    !depositQuote?.first_deposit;
  const removeReady =
    liquiditySettingsValid && gasFee !== undefined && withdrawQuote !== undefined && !withdrawalFetching && lpToRemove.toString() === debouncedLp &&
    tab === "remove" &&
    lpBalance !== undefined &&
    lpToRemove > 0n &&
    !busy;

  const intentKey = JSON.stringify([asset, address, tab, editSide, amount, pct, lqSlippage, customFee, liquiditySettingsValid, pool?.lp_asset]);
  const currentIntent = useRef(intentKey);
  useEffect(() => { currentIntent.current = intentKey; }, [intentKey]);

  const submitAdd = async () => {
    if (!addReady || !depositQuote || !depositUrl) return;
    const submittedIntent = intentKey;
    setQuoteRefreshError(false);
    setRefreshing(true);
    try {
      const fresh = validateDepositQuote((await fetchJson(depositUrl)).result,
        editSide === "token" ? asset : "XCP", editSide === "token" ? "XCP" : asset, amountExact);
      if (currentIntent.current !== submittedIntent) return;
      // The paired spend is part of the review. Show a changed quote before
      // accepting it, and never weaken the displayed minimum LP quantity.
      if (fresh.first_deposit || big(fresh.quantity_a_required) !== big(depositQuote.quantity_a_required)
        || big(fresh.quantity_b_required) !== big(depositQuote.quantity_b_required)
        || big(fresh.quantity_minted_estimate) < reduceByPercent(depositQuote.quantity_minted_estimate, lqSlippage)) {
        await mutateDeposit(fresh, { revalidate: false });
        setQuoteRefreshError(true);
        return;
      }
    if (submittedTrade.current) return;
    setSubmittedAction("add");
    // Freeze both debits and the protocol gas estimate before signing.
    submittedTrade.current = {
      pending: {
        kind: "pool",
        label: t("Add {asset}/XCP liquidity", { asset }),
        address: address ?? undefined,
        spends: [
          { asset, raw: big(depTokenRaw).toString() },
          { asset: "XCP", raw: (big(depXcpRaw) + big(gasFee ?? 0)).toString() },
        ],
      },
      action: "liquidity added",
      usd: xcpUsd && depXcpNum > 0 ? (depXcpNum / SATS) * xcpUsd * 2 : null,
    };
    compose.composePoolDeposit({
      asset_a: asset,
      asset_b: "XCP",
      quantity_a: big(depTokenRaw),
      quantity_b: big(depXcpRaw),
      min_lp_quantity: reduceByPercent(
        depositQuote.quantity_minted_estimate,
        lqSlippage,
      ),
      fee_rate: customFee ?? undefined,
    });
    } catch { setQuoteRefreshError(true); }
    finally { setRefreshing(false); }
  };

  const submitRemove = async () => {
    if (!removeReady || !pool || !withdrawQuote || !withdrawalUrl) return;
    const submittedIntent = intentKey;
    setQuoteRefreshError(false);
    setRefreshing(true);
    try {
      const fresh = validateWithdrawQuote((await fetchJson(withdrawalUrl)).result, asset, "XCP", lpToRemove);
      if (currentIntent.current !== submittedIntent) return;
      if (fresh.asset_a !== pool.asset_a || fresh.asset_b !== pool.asset_b
        || big(fresh.quantity_a_estimate) < reduceByPercent(withdrawQuote.quantity_a_estimate, lqSlippage)
        || big(fresh.quantity_b_estimate) < reduceByPercent(withdrawQuote.quantity_b_estimate, lqSlippage)) {
        setQuoteRefreshError(true);
        return;
      }
    if (submittedTrade.current) return;
    setSubmittedAction("remove");
    submittedTrade.current = {
      pending: {
        kind: "pool",
        label: t("Remove {asset}/XCP liquidity", { asset }),
        address: address ?? undefined,
        spends: [
          { asset: pool.lp_asset, raw: lpToRemove.toString() },
          ...(big(gasFee ?? 0) > 0n ? [{ asset: "XCP", raw: big(gasFee ?? 0).toString() }] : []),
        ],
      },
      action: "liquidity removed",
      usd: xcpUsd && approx(outXcpRaw) > 0 ? (approx(outXcpRaw) / SATS) * xcpUsd * 2 : null,
    };
    compose.composePoolWithdraw({
      lp_asset: pool.lp_asset,
      quantity: lpToRemove,
      min_quantity_a: reduceByPercent(withdrawQuote?.quantity_a_estimate, lqSlippage),
      min_quantity_b: reduceByPercent(withdrawQuote?.quantity_b_estimate, lqSlippage),
      fee_rate: customFee ?? undefined,
    });
    } catch { setQuoteRefreshError(true); }
    finally { setRefreshing(false); }
  };

  const addLabel = busy
    ? compose.status === "signing"
      ? t("Confirm in wallet…")
      : t("Working…")
    : amountRaw === 0
      ? t("Enter an amount")
      : !balancesSettled
        ? t("Checking balance…")
      : insufficientToken
        ? t("Insufficient {asset} balance", { asset })
        : insufficientXcp
          ? t("Insufficient XCP balance")
          : depositQuote?.first_deposit
            ? t("Pool is empty")
            : depStale && depXcpNum === 0
              ? t("Fetching quote…")
              : t("Add liquidity");

  // Both legs are worth the same by construction; USD comes off the XCP leg.
  const legUsd = xcpUsd && depXcpNum > 0 ? (depXcpNum / SATS) * xcpUsd : null;

  const txFeeRow = feeRate !== null && (
    <div className="flex justify-between">
      <dt>{t("TX fee")}</dt>
      <dd className={customFee !== null ? "font-medium text-purple-600 dark:text-purple-400" : ""}>
        {num.satsPerVb(feeRate)} sat/vB
        {btcUsd != null && (
          <span className="text-gray-400 dark:text-gray-500">
            {" "}
            (~{usdFmt(((feeRate * POOL_VBYTES) / SATS) * btcUsd)})
          </span>
        )}
      </dd>
    </div>
  );

  const gasRow = (gasFee ?? 0) > 0 && (
    <div className="flex justify-between">
      <dt>{t("Protocol gas fee")}</dt>
      <dd>{num.commasRaw(gasFee ?? 0)} XCP</dd>
    </div>
  );

  return (
    <div className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2">
      <div className="flex items-center gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 text-sm font-medium">
        {(["add", "remove"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg px-3 py-1.5 capitalize ${
              tab === k
                ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {k === "add" ? t("add") : t("remove")}
          </button>
        ))}
      </div>

      {tab === "add" ? (
        <div className="mt-2">
          {/* Token well — corner grammar: presets top-right, balance bottom-right */}
          <Well
            focusable
            label={t("Deposit")}
            topRight={
              maxDepositRaw > 0 ? (
                <span className="flex items-center gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setEditSide("token");
                        setTokenAmount(
                          rawToInput(percentOf(maxDepositRaw, p), 8),
                        );
                      }}
                      className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95"
                    >
                      {p === 100 ? t("Max") : num.percent(p / 100, { digits: 0 })}
                    </button>
                  ))}
                </span>
              ) : undefined
            }
            chip={
              assets.length > 1 ? (
                <AssetChip asset={asset} onClick={() => setSelectorOpen(true)} />
              ) : (
                <AssetChip asset={asset} />
              )
            }
            footer={
              <>
                <span>≈ {usdFmt(legUsd ?? 0)}</span>
                {tokenBalance !== undefined && (
                  <button
                    type="button"
                    className={`min-w-0 truncate hover:text-purple-600 dark:hover:text-purple-400 ${
                      insufficientToken ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
                    }`}
                    onClick={() => {
                      setEditSide("token");
                      setTokenAmount(rawToInput(maxDepositRaw, 8));
                    }}
                  >
                    {t("Balance: {n}", { n: num.commasRaw(tokenBalance) })}
                  </button>
                )}
                {tokenBalance === undefined && <BalanceUnavailable error={tokenBalanceError} />}
              </>
            }
          >
            <AmountInput
              value={
                editSide === "token"
                  ? tokenAmount
                  : depTokenNum > 0
                    ? rawToInput(depTokenRaw, 8)
                    : ""
              }
              onChange={(v) => {
                setEditSide("token");
                setTokenAmount(v);
              }}
              ariaLabel={t("Amount of {asset} to deposit", { asset })}
              className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600 ${
                insufficientToken ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
              }`}
              style={
                editSide === "xcp" && depStale
                  ? { filter: "grayscale(1)", opacity: 0.4 }
                  : undefined
              }
            />
          </Well>

          {/* XCP well — the other leg, equally editable */}
          <div className="mt-1">
            <Well
              focusable
              label={t("Paired XCP")}
              chip={<AssetChip asset="XCP" />}
              footer={
                <>
                  <span>≈ {usdFmt(legUsd ?? 0)}</span>
                  {xcpBalance !== undefined && (
                    <button
                      type="button"
                      className={`min-w-0 truncate hover:text-purple-600 dark:hover:text-purple-400 ${
                        insufficientXcp ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
                      }`}
                      onClick={() => {
                        // Fill the largest affordable XCP leg — bounded by
                        // the token side through the ratio, minus gas.
                        setEditSide("xcp");
                        setXcpAmount(
                          rawToInput(
                              minRaw(
                                maxRaw(0n, big(xcpBalance) - big(gasFee ?? 0)),
                                reserveToken > 0n
                                  ? (big(tokenBalance ?? 0) * reserveXcp) /
                                      reserveToken
                                  : big(xcpBalance),
                              ),
                            8,
                          ),
                        );
                      }}
                    >
                      {t("Balance: {n}", { n: num.commasRaw(xcpBalance) })}
                    </button>
                  )}
                  {xcpBalance === undefined && <BalanceUnavailable error={xcpBalanceError} />}
                </>
              }
            >
              <AmountInput
                value={
                  editSide === "xcp"
                    ? xcpAmount
                    : depXcpNum > 0
                      ? rawToInput(depXcpRaw, 8)
                      : ""
                }
                onChange={(v) => {
                  setEditSide("xcp");
                  setXcpAmount(v);
                }}
                ariaLabel={t("Amount of XCP to deposit")}
                className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600 ${
                  insufficientXcp ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
                }`}
                style={
                  editSide === "token" && depStale
                    ? { filter: "grayscale(1)", opacity: 0.4 }
                    : undefined
                }
              />
            </Well>
          </div>

          {/* Rate line — pool spot from reserves, tap to invert */}
          {spotRate !== null && (
            <div className="flex h-6 items-center px-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setRateInverted((v) => !v)}
                aria-label={t("Invert rate")}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                {rateInverted
                  ? `1 XCP = ${num.price(1 / spotRate)} ${asset}`
                  : `1 ${asset} = ${num.price(spotRate)} XCP`}
                {xcpUsd && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {" "}
                    ({usdFmt(rateInverted ? xcpUsd : spotRate * xcpUsd)})
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Receipt — always open once a quote is live */}
          {depositQuote && amountRaw > 0 && !depositQuote.first_deposit && (
            <div className="px-2">
              <dl className="space-y-1.5 border-t border-gray-100 dark:border-gray-800 pt-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex justify-between">
                  <dt>{t("LP minted (est.)")}</dt>
                  <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">
                    {num.commasRaw(depositQuote.quantity_minted_estimate)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("Min LP · slippage {pct}%", { pct: num.commas(lqSlippage) })}</dt>
                  <dd className="tabular-nums">
                    {num.commasRaw(
                      reduceByPercent(
                        depositQuote.quantity_minted_estimate,
                        lqSlippage,
                      ),
                    )}
                  </dd>
                </div>
                {lpSupply > 0n && (
                  <div className="flex justify-between">
                    <dt>{t("Share of pool")}</dt>
                    <dd className="tabular-nums">
                      {pctFmt(
                        ratio(
                          depositQuote.quantity_minted_estimate,
                          lpSupply + big(depositQuote.quantity_minted_estimate),
                        ) * 100,
                      )}
                    </dd>
                  </div>
                )}
                {gasRow}
                {txFeeRow}
              </dl>
            </div>
          )}

          {/* Your position — context while adding to an existing stake */}
          {(lpBalance ?? 0) > 0 && lpSupply > 0n && (
            <p className="px-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
              {rich(t, "Your position: {position} · {pct} of the pool", {
                position: (
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {num.commasRaw((big(lpBalance ?? 0) * reserveToken) / lpSupply)}{" "}
                    {asset}
                    {" + "}
                    {num.commasRaw((big(lpBalance ?? 0) * reserveXcp) / lpSupply)}{" "}
                    XCP
                  </span>
                ),
                pct: pctFmt(ratio(lpBalance ?? 0, lpSupply) * 100),
              })}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/60 p-4">
            <div className="flex items-baseline justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{t("Amount to remove")}</span>
              <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {num.percent(pct / 100, { digits: 0 })}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="ui-slider mt-2 w-full"
              aria-label={t("Percent of LP to remove")}
            />
            <div className="mt-2 flex items-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    pct === p
                      ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300"
                      : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600"
                  }`}
                >
                  {p === 100 ? t("Max") : num.percent(p / 100, { digits: 0 })}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2">
            <dl className="space-y-1.5 border-t border-gray-100 dark:border-gray-800 pt-2 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex justify-between">
                <dt>{t("Your LP balance")}</dt>
                <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">
                  {num.commasRaw(lpBalance ?? 0)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{t("You receive (est.)")}</dt>
                <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">
                  {num.commasRaw(outTokenRaw)} {asset} + {num.commasRaw(outXcpRaw)} XCP
                  {xcpUsd && approx(outXcpRaw) > 0 ? (
                    <span className="font-normal text-gray-400 dark:text-gray-500">
                      {" "}
                      (≈{usdFmt(2 * (approx(outXcpRaw) / SATS) * xcpUsd)})
                    </span>
                  ) : null}
                </dd>
              </div>
              {approx(outTokenRaw) > 0 && (
                <div className="flex justify-between">
                  <dt>{t("Min received · slippage {pct}%", { pct: num.commas(lqSlippage) })}</dt>
                  <dd className="tabular-nums">
                    {num.commasRaw(reduceByPercent(outTokenRaw, lqSlippage))}{" "}
                    {asset} +{" "}
                    {num.commasRaw(reduceByPercent(outXcpRaw, lqSlippage))} XCP
                  </dd>
                </div>
              )}
              {gasRow}
              {txFeeRow}
            </dl>
          </div>
        </div>
      )}

      <div className="px-0.5 pb-0.5 pt-3">
        {quoteRefreshError && <ErrorBanner className="mb-2" onDismiss={() => setQuoteRefreshError(false)}>{t("Quote changed or could not be refreshed. Review the amounts and try again.")}</ErrorBanner>}
        {compose.status === "error" && (
          <ErrorBanner className="mb-2" onDismiss={compose.reset}><ComposeError {...compose} /></ErrorBanner>
        )}

        {walletStatus !== "connected" ? (
          <ConnectButton />
        ) : (
          <CTA
            disabled={tab === "add" ? !addReady : !removeReady}
            onClick={tab === "add" ? submitAdd : submitRemove}
          >
            {tab === "add"
              ? addLabel
              : busy
                ? compose.status === "signing"
                  ? t("Confirm in wallet…")
                  : t("Working…")
                : lpToRemove === 0n
                  ? lpBalance === undefined
                    ? lpBalanceError
                      ? t("Balance unavailable")
                      : t("Checking balance…")
                    : lpBalance === 0n
                    ? t("No LP in this pool")
                    : t("Choose an amount")
                  : t("Remove liquidity")}
          </CTA>
        )}
        {compose.status === "confirmed" && (
          <div className="mt-2 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800 dark:text-green-300">
                {submittedAction === "add"
                  ? rich(t, "Deposit broadcast — {tx}", { tx: <TxLink txid={compose.txid} /> })
                  : rich(t, "Withdrawal broadcast — {tx}", { tx: <TxLink txid={compose.txid} /> })}
              </span>
              <button
                type="button"
                onClick={compose.reset}
                className="text-xs text-green-800 dark:text-green-300 underline"
              >
                {t("Dismiss")}
              </button>
            </div>
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              {t("Settles when it confirms — usually the next block.")}
            </p>
          </div>
        )}
      </div>

      <TokenSelectModal
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        assets={assets}
        selected={asset}
        address={address}
        title={t("Select a pool")}
        rowLabel={(a) => `${a} / XCP`}
        onSelect={(a) => {
          setAsset(a);
          setTokenAmount("");
          setXcpAmount("");
        }}
      />
    </div>
  );
}
