"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { AssetChip } from "@/components/asset-chip";
import { TokenSelectModal } from "@/components/token-select-modal";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Well } from "@/components/ui/well";
import { fetchBtcUsd } from "@/lib/api/price-client";
import { commasRaw, price as formatPrice, satsPerVb, usd as usdFmt } from "@/lib/format";
import {
  approx,
  big,
  maxRaw,
  minRaw,
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
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { useSwapSettings } from "@/app/swap/_components/swap-settings";
import { defaultTradeAsset } from "@/lib/trade-selection";

/** Pool tx size for the TX-fee estimate; true size known after compose. */
const POOL_VBYTES = 250;
const PRESETS = [25, 50, 75, 100] as const;
const fmtAmount = (n: number) => n.toFixed(8).replace(/\.?0+$/, "");

interface PoolInfo {
  asset_a: string;
  asset_b: string;
  reserve_a: Raw;
  reserve_b: Raw;
  lp_asset: string;
}

interface DepositQuote {
  first_deposit: boolean;
  asset_a: string;
  asset_b: string;
  quantity_a_required: Raw | null;
  quantity_b_required: Raw | null;
  quantity_minted_estimate: Raw | null;
}

interface WithdrawQuote {
  pool_exists: boolean;
  asset_a?: string;
  asset_b?: string;
  quantity_a_estimate?: Raw;
  quantity_b_estimate?: Raw;
  supply?: Raw;
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
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const [asset, setAsset] = useState(() => defaultTradeAsset(assets));
  const [tab, setTab] = useState<"add" | "remove">("add");
  // Bidirectional add: edit either leg and the other derives at the pool
  // ratio — consensus clamps every deposit to the current ratio, so you
  // don't get to pick one (if you don't like the price, place an order).
  const [tokenAmount, setTokenAmount] = useState("");
  const [xcpAmount, setXcpAmount] = useState("");
  const [editSide, setEditSide] = useState<"token" | "xcp">("token");
  const [rateInverted, setRateInverted] = useState(false);
  const [pct, setPct] = useState(25); // remove tab
  const [selectorOpen, setSelectorOpen] = useState(false);

  const { lqSlippage, customFee, medianFeeRate } = useSwapSettings();
  const feeRate = customFee > 0 ? customFee : (medianFeeRate ?? null);
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
  // Parse the typed digits exactly; the double beside it feeds UI and the
  // quote URL only.
  const amountExact = parseUnitsToRaw(amount) ?? 0n;
  const amountRaw = approx(amountExact);
  const debouncedRaw = useDebounced(amountRaw, 250);
  // The quote's `quantity` is the FIRST asset in the URL path (verified in
  // counterparty-core queries.get_pool_quote_deposit) — flip the pair to
  // quote by whichever side is being edited. Response assets are canonical.
  const { data: depositQuote, isValidating: depFetching } = useSWR<DepositQuote>(
    tab === "add" && asset && debouncedRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${
          editSide === "token" ? `${asset}/XCP` : `XCP/${asset}`
        }/quote/deposit?quantity=${debouncedRaw}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 60_000, keepPreviousData: true },
  );
  const depStale = depFetching || amountRaw !== debouncedRaw;
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

  const { balance: tokenBalance, balanceError: tokenBalanceError } = useSpendableBalance(
    address,
    asset,
    "liquidity-token",
  );
  const { balance: xcpBalance, balanceError: xcpBalanceError } = useSpendableBalance(
    address,
    "XCP",
    "liquidity-xcp",
  );

  // Congestion-priced XCP gas for pool ops — usually 0, but never hardcode.
  const { data: gasFee } = useSWR<number>(
    address
      ? `${COUNTERPARTY_API_BASE}/addresses/${address}/compose/${
          tab === "add" ? "pooldeposit" : "poolwithdraw"
        }/estimatexcpfees`
      : null,
    (url: string) => fetchJson(url).then((d) => Number(d.result) || 0),
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
  const pctFmt = (x: number) =>
    x >= 100 ? "100%" : x >= 0.01 ? `${x.toFixed(2)}%` : "<0.01%";
  const lpToRemove = percentOf(lpBalance ?? 0, pct);
  const debouncedLp = useDebounced(approx(lpToRemove), 250);

  const { data: withdrawQuote } = useSWR<WithdrawQuote>(
    tab === "remove" && asset && debouncedLp > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/withdraw?quantity=${debouncedLp}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 60_000, keepPreviousData: true },
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

  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "confirmed") {
      registerPending({
        txid: compose.txid,
        kind: "pool",
        label: `${tab === "add" ? "Add" : "Remove"} ${asset}/XCP liquidity`,
        address: address ?? undefined,
        spends:
          tab === "add"
            ? [
                { asset, raw: big(depTokenRaw).toString() },
                {
                  asset: "XCP",
                  raw: (big(depXcpRaw) + big(gasFee ?? 0)).toString(),
                },
              ]
            : pool?.lp_asset
              ? [{ asset: pool.lp_asset, raw: lpToRemove.toString() }]
              : undefined,
      });
    }
  }, [
    compose.status,
    compose.txid,
    tab,
    asset,
    address,
    depTokenRaw,
    depXcpRaw,
    gasFee,
    pool?.lp_asset,
    lpToRemove,
  ]);

  const needTokenRaw = editSide === "token" ? amountRaw : depTokenNum;
  const insufficientToken =
    tokenBalance !== undefined &&
    needTokenRaw > 0 &&
    needTokenRaw > tokenBalance;
  // The XCP leg must cover the deposit plus any XCP gas fee.
  const insufficientXcp =
    xcpBalance !== undefined &&
    depXcpNum > 0 &&
    depXcpNum + (gasFee ?? 0) > xcpBalance;

  const addReady =
    tab === "add" &&
    amountRaw > 0 &&
    depTokenNum > 0 &&
    depXcpNum > 0 &&
    tokenBalance !== undefined &&
    xcpBalance !== undefined &&
    !busy &&
    !insufficientToken &&
    !insufficientXcp &&
    !depositQuote?.first_deposit;
  const removeReady =
    tab === "remove" &&
    lpBalance !== undefined &&
    lpToRemove > 0n &&
    !busy;

  const submitAdd = () => {
    if (!addReady || !depositQuote) return;
    compose.composePoolDeposit({
      asset_a: asset,
      asset_b: "XCP",
      quantity_a: big(depTokenRaw),
      quantity_b: big(depXcpRaw),
      min_lp_quantity: reduceByPercent(
        depositQuote.quantity_minted_estimate,
        lqSlippage,
      ),
      fee_rate: customFee > 0 ? customFee : undefined,
    });
  };

  const submitRemove = () => {
    if (!removeReady || !pool) return;
    compose.composePoolWithdraw({
      lp_asset: pool.lp_asset,
      quantity: lpToRemove,
      min_quantity_a: reduceByPercent(withdrawQuote?.quantity_a_estimate, lqSlippage),
      min_quantity_b: reduceByPercent(withdrawQuote?.quantity_b_estimate, lqSlippage),
      fee_rate: customFee > 0 ? customFee : undefined,
    });
  };

  const addLabel = busy
    ? compose.status === "signing"
      ? "Confirm in wallet…"
      : "Working…"
    : amountRaw === 0
      ? "Enter an amount"
      : tokenBalance === undefined || xcpBalance === undefined
        ? tokenBalanceError || xcpBalanceError
          ? "Balance unavailable"
          : "Checking balance…"
      : insufficientToken
        ? `Insufficient ${asset} balance`
        : insufficientXcp
          ? "Insufficient XCP balance"
          : depositQuote?.first_deposit
            ? "Pool is empty"
            : depStale && depXcpNum === 0
              ? "Fetching quote…"
              : "Add liquidity";

  // Both legs are worth the same by construction; USD comes off the XCP leg.
  const legUsd = xcpUsd && depXcpNum > 0 ? (depXcpNum / SATS) * xcpUsd : null;

  // Placed after legUsd for the value; the add and remove sides are separate
  // events because they mean opposite things about a pool's depth.
  useEffect(() => {
    if (compose.status === "confirmed") {
      const withdrawUsd =
        xcpUsd && approx(outXcpRaw) > 0 ? (approx(outXcpRaw) / SATS) * xcpUsd * 2 : null;
      trackTx(
        compose.txid,
        tab === "add" ? "liquidity added" : "liquidity removed",
        // A deposit is both legs; legUsd is one of two equal legs.
        tab === "add" ? (legUsd === null ? null : legUsd * 2) : withdrawUsd,
      );
    }
  }, [compose.status, compose.txid, tab, legUsd, outXcpRaw, xcpUsd]);

  const txFeeRow = feeRate !== null && (
    <div className="flex justify-between">
      <dt>TX fee</dt>
      <dd className={customFee > 0 ? "font-medium text-purple-600" : ""}>
        {satsPerVb(feeRate)} sat/vB
        {btcUsd != null && (
          <span className="text-gray-400">
            {" "}
            (~{usdFmt(((feeRate * POOL_VBYTES) / SATS) * btcUsd)})
          </span>
        )}
      </dd>
    </div>
  );

  const gasRow = (gasFee ?? 0) > 0 && (
    <div className="flex justify-between">
      <dt>Protocol gas fee</dt>
      <dd>{commasRaw(gasFee ?? 0)} XCP</dd>
    </div>
  );

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-sm font-medium">
        {(["add", "remove"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-1.5 capitalize ${
              tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "add" ? (
        <div className="mt-2">
          {/* Token well — corner grammar: presets top-right, balance bottom-right */}
          <Well
            focusable
            label="Deposit"
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
                          fmtAmount(approx(percentOf(maxDepositRaw, p)) / SATS),
                        );
                      }}
                      className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600 active:scale-95"
                    >
                      {p === 100 ? "Max" : `${p}%`}
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
                    className={`min-w-0 truncate hover:text-purple-600 ${
                      insufficientToken ? "text-red-600" : "text-gray-500"
                    }`}
                    onClick={() => {
                      setEditSide("token");
                      setTokenAmount(fmtAmount(approx(maxDepositRaw) / SATS));
                    }}
                  >
                    Balance: {commasRaw(tokenBalance)}
                  </button>
                )}
              </>
            }
          >
            <AmountInput
              value={
                editSide === "token"
                  ? tokenAmount
                  : depTokenNum > 0
                    ? fmtAmount(depTokenNum / SATS)
                    : ""
              }
              onChange={(v) => {
                setEditSide("token");
                setTokenAmount(v);
              }}
              ariaLabel={`Amount of ${asset} to deposit`}
              className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
                insufficientToken ? "text-red-600" : "text-gray-900"
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
              label="Paired XCP"
              chip={<AssetChip asset="XCP" />}
              footer={
                <>
                  <span>≈ {usdFmt(legUsd ?? 0)}</span>
                  {xcpBalance !== undefined && (
                    <button
                      type="button"
                      className={`min-w-0 truncate hover:text-purple-600 ${
                        insufficientXcp ? "text-red-600" : "text-gray-500"
                      }`}
                      onClick={() => {
                        // Fill the largest affordable XCP leg — bounded by
                        // the token side through the ratio, minus gas.
                        setEditSide("xcp");
                        setXcpAmount(
                          fmtAmount(
                            approx(
                              minRaw(
                                maxRaw(0n, big(xcpBalance) - big(gasFee ?? 0)),
                                reserveToken > 0n
                                  ? (big(tokenBalance ?? 0) * reserveXcp) /
                                      reserveToken
                                  : big(xcpBalance),
                              ),
                            ) / SATS,
                          ),
                        );
                      }}
                    >
                      Balance: {commasRaw(xcpBalance)}
                    </button>
                  )}
                </>
              }
            >
              <AmountInput
                value={
                  editSide === "xcp"
                    ? xcpAmount
                    : depXcpNum > 0
                      ? fmtAmount(depXcpNum / SATS)
                      : ""
                }
                onChange={(v) => {
                  setEditSide("xcp");
                  setXcpAmount(v);
                }}
                ariaLabel="Amount of XCP to deposit"
                className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
                  insufficientXcp ? "text-red-600" : "text-gray-900"
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
                aria-label="Invert rate"
                className="text-gray-600 hover:text-gray-900"
              >
                {rateInverted
                  ? `1 XCP = ${formatPrice(1 / spotRate)} ${asset}`
                  : `1 ${asset} = ${formatPrice(spotRate)} XCP`}
                {xcpUsd && (
                  <span className="text-gray-400">
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
              <dl className="space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
                <div className="flex justify-between">
                  <dt>LP minted (est.)</dt>
                  <dd className="font-medium tabular-nums text-gray-700">
                    {commasRaw(depositQuote.quantity_minted_estimate)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Min LP · slippage {lqSlippage}%</dt>
                  <dd className="tabular-nums">
                    {commasRaw(
                      reduceByPercent(
                        depositQuote.quantity_minted_estimate,
                        lqSlippage,
                      ),
                    )}
                  </dd>
                </div>
                {lpSupply > 0n && (
                  <div className="flex justify-between">
                    <dt>Share of pool</dt>
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
            <p className="px-2 pt-2 text-xs text-gray-500">
              Your position:{" "}
              <span className="font-medium text-gray-700">
                {commasRaw((big(lpBalance ?? 0) * reserveToken) / lpSupply)}{" "}
                {asset}
                {" + "}
                {commasRaw((big(lpBalance ?? 0) * reserveXcp) / lpSupply)}{" "}
                XCP
              </span>{" "}
              · {pctFmt(ratio(lpBalance ?? 0, lpSupply) * 100)} of the pool
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="rounded-2xl bg-gray-50 p-4">
            <div className="flex items-baseline justify-between text-xs text-gray-500">
              <span>Amount to remove</span>
              <span className="text-3xl font-bold text-gray-900">{pct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="ui-slider mt-2 w-full"
              aria-label="Percent of LP to remove"
            />
            <div className="mt-2 flex items-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    pct === p
                      ? "border-purple-600 bg-purple-50 text-purple-700"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {p === 100 ? "Max" : `${p}%`}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2">
            <dl className="space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Your LP balance</dt>
                <dd className="font-medium tabular-nums text-gray-700">
                  {commasRaw(lpBalance ?? 0)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>You receive (est.)</dt>
                <dd className="font-medium tabular-nums text-gray-700">
                  {commasRaw(outTokenRaw)} {asset} + {commasRaw(outXcpRaw)} XCP
                  {xcpUsd && approx(outXcpRaw) > 0 ? (
                    <span className="font-normal text-gray-400">
                      {" "}
                      (≈{usdFmt(2 * (approx(outXcpRaw) / SATS) * xcpUsd)})
                    </span>
                  ) : null}
                </dd>
              </div>
              {approx(outTokenRaw) > 0 && (
                <div className="flex justify-between">
                  <dt>Min received · slippage {lqSlippage}%</dt>
                  <dd className="tabular-nums">
                    {commasRaw(reduceByPercent(outTokenRaw, lqSlippage))}{" "}
                    {asset} +{" "}
                    {commasRaw(reduceByPercent(outXcpRaw, lqSlippage))} XCP
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
        {compose.status === "error" && (
          <ErrorBanner className="mb-2" onDismiss={compose.reset}>{compose.error}</ErrorBanner>
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
                  ? "Confirm in wallet…"
                  : "Working…"
                : lpToRemove === 0n
                  ? lpBalance === undefined
                    ? lpBalanceError
                      ? "Balance unavailable"
                      : "Checking balance…"
                    : lpBalance === 0n
                    ? "No LP in this pool"
                    : "Choose an amount"
                  : "Remove liquidity"}
          </CTA>
        )}
        {compose.status === "confirmed" && (
          <div className="mt-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800">
                {tab === "add" ? "Deposit" : "Withdrawal"} broadcast —{" "}
                <TxLink txid={compose.txid} />
              </span>
              <button
                type="button"
                onClick={compose.reset}
                className="text-xs text-green-800 underline"
              >
                Dismiss
              </button>
            </div>
            <p className="mt-1 text-xs text-green-700">
              Settles when it confirms — usually the next block.
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
        title="Select a pool"
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
