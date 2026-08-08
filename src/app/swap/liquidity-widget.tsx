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
import { commas, price as formatPrice, usd as usdFmt } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { registerPending } from "@/lib/pending";
import { isBusy } from "@/lib/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchBalance, fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { useSwapSettings } from "./swap-settings";

const SATS = 1e8;
/** Pool tx size for the TX-fee estimate; true size known after compose. */
const POOL_VBYTES = 250;
const PRESETS = [25, 50, 75, 100] as const;
const fmtAmount = (n: number) => n.toFixed(8).replace(/\.?0+$/, "");

interface PoolInfo {
  asset_a: string;
  asset_b: string;
  reserve_a: number;
  reserve_b: number;
  lp_asset: string;
}

interface DepositQuote {
  first_deposit: boolean;
  asset_a: string;
  asset_b: string;
  quantity_a_required: number | null;
  quantity_b_required: number | null;
  quantity_minted_estimate: number | null;
}

interface WithdrawQuote {
  pool_exists: boolean;
  asset_a?: string;
  asset_b?: string;
  quantity_a_estimate?: number;
  quantity_b_estimate?: number;
  supply?: number;
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
  const [asset, setAsset] = useState(assets[0] ?? "");
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
  const tolerance = lqSlippage / 100;
  const feeRate = customFee > 0 ? customFee : (medianFeeRate ?? null);
  const { data: btcUsd } = useSWR(
    "btc-usd",
    () =>
      fetchJson("https://mempool.space/api/v1/prices").then(
        (d: { USD: number }) => d.USD,
      ),
    { refreshInterval: 60_000 },
  );

  const { data: pool } = useSWR<PoolInfo | null>(
    asset ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP` : null,
    (url: string) => fetchJson(url).then((d) => d.result ?? null),
    { refreshInterval: 30_000 },
  );

  const amount = editSide === "token" ? tokenAmount : xcpAmount;
  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);
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
  const depTokenRaw = depositQuote
    ? (depositQuote.asset_a === asset
        ? depositQuote.quantity_a_required
        : depositQuote.quantity_b_required) ?? 0
    : 0;
  const depXcpRaw = depositQuote
    ? (depositQuote.asset_a === "XCP"
        ? depositQuote.quantity_a_required
        : depositQuote.quantity_b_required) ?? 0
    : 0;

  const { data: tokenBalance } = useSWR(
    address && asset ? [address, asset, "lq-token-balance"] : null,
    ([addr, a]) => fetchBalance(addr, a),
    { refreshInterval: 30_000 },
  );
  const { data: xcpBalance } = useSWR(
    address ? [address, "XCP", "lq-xcp-balance"] : null,
    ([addr]) => fetchBalance(addr, "XCP"),
    { refreshInterval: 30_000 },
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

  const { data: lpBalance } = useSWR(
    address && pool?.lp_asset
      ? [address, pool.lp_asset, "lq-lp-balance"]
      : null,
    ([addr, lp]) => fetchBalance(addr, lp),
    { refreshInterval: 30_000 },
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
  const lpSupply = poolMeta?.supply ?? 0;
  const reserveToken = pool
    ? pool.asset_a === asset
      ? pool.reserve_a
      : pool.reserve_b
    : 0;
  const reserveXcp = pool
    ? pool.asset_a === "XCP"
      ? pool.reserve_a
      : pool.reserve_b
    : 0;
  // Spot rate from reserves — no endpoint computes it (verified in source).
  const spotRate = reserveToken > 0 ? reserveXcp / reserveToken : null;
  // The largest deposit you can actually make: bounded by BOTH balances
  // through the pool ratio (the XCP leg must also cover any protocol gas).
  // Presets mean "% of what you can do", not "% of one balance".
  const maxDepositRaw =
    reserveXcp > 0
      ? Math.min(
          tokenBalance ?? 0,
          Math.floor(
            (Math.max(0, (xcpBalance ?? 0) - (gasFee ?? 0)) * reserveToken) /
              reserveXcp,
          ),
        )
      : (tokenBalance ?? 0);
  const pctFmt = (x: number) =>
    x >= 100 ? "100%" : x >= 0.01 ? `${x.toFixed(2)}%` : "<0.01%";
  const lpToRemove = Math.floor(((lpBalance ?? 0) * pct) / 100);
  const debouncedLp = useDebounced(lpToRemove, 250);

  const { data: withdrawQuote } = useSWR<WithdrawQuote>(
    tab === "remove" && asset && debouncedLp > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/withdraw?quantity=${debouncedLp}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 60_000, keepPreviousData: true },
  );
  const outTokenRaw = withdrawQuote
    ? (withdrawQuote.asset_a === asset
        ? withdrawQuote.quantity_a_estimate
        : withdrawQuote.quantity_b_estimate) ?? 0
    : 0;
  const outXcpRaw = withdrawQuote
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
      });
    }
  }, [compose.status, compose.txid, tab, asset, address]);

  const needTokenRaw = editSide === "token" ? amountRaw : depTokenRaw;
  const insufficientToken =
    tokenBalance !== undefined &&
    needTokenRaw > 0 &&
    needTokenRaw > tokenBalance;
  // The XCP leg must cover the deposit plus any XCP gas fee.
  const insufficientXcp =
    xcpBalance !== undefined &&
    depXcpRaw > 0 &&
    depXcpRaw + (gasFee ?? 0) > xcpBalance;

  const addReady =
    tab === "add" &&
    amountRaw > 0 &&
    depTokenRaw > 0 &&
    depXcpRaw > 0 &&
    !busy &&
    !insufficientToken &&
    !insufficientXcp &&
    !depositQuote?.first_deposit;
  const removeReady = tab === "remove" && lpToRemove > 0 && !busy;

  const submitAdd = () => {
    if (!addReady || !depositQuote) return;
    compose.composePoolDeposit({
      asset_a: asset,
      asset_b: "XCP",
      quantity_a: depTokenRaw,
      quantity_b: depXcpRaw,
      min_lp_quantity: Math.floor(
        (depositQuote.quantity_minted_estimate ?? 0) * (1 - tolerance),
      ),
      fee_rate: customFee > 0 ? customFee : undefined,
    });
  };

  const submitRemove = () => {
    if (!removeReady || !pool) return;
    compose.composePoolWithdraw({
      lp_asset: pool.lp_asset,
      quantity: lpToRemove,
      min_quantity_a: Math.floor(
        (withdrawQuote?.quantity_a_estimate ?? 0) * (1 - tolerance),
      ),
      min_quantity_b: Math.floor(
        (withdrawQuote?.quantity_b_estimate ?? 0) * (1 - tolerance),
      ),
      fee_rate: customFee > 0 ? customFee : undefined,
    });
  };

  const addLabel = busy
    ? compose.status === "signing"
      ? "Confirm in wallet…"
      : "Working…"
    : amountRaw === 0
      ? "Enter an amount"
      : insufficientToken
        ? `Insufficient ${asset} balance`
        : insufficientXcp
          ? "Insufficient XCP balance"
          : depositQuote?.first_deposit
            ? "Pool is empty"
            : depStale && depXcpRaw === 0
              ? "Fetching quote…"
              : "Add liquidity";

  // Both legs are worth the same by construction; USD comes off the XCP leg.
  const legUsd = xcpUsd && depXcpRaw > 0 ? (depXcpRaw / SATS) * xcpUsd : null;

  const txFeeRow = feeRate !== null && (
    <div className="flex justify-between">
      <dt>TX fee</dt>
      <dd className={customFee > 0 ? "font-medium text-purple-600" : ""}>
        {feeRate} sat/vB
        {btcUsd !== undefined && (
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
      <dd>{commas((gasFee ?? 0) / SATS)} XCP</dd>
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
                          fmtAmount(
                            Math.floor((maxDepositRaw * p) / 100) / SATS,
                          ),
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
                      setTokenAmount(fmtAmount(maxDepositRaw / SATS));
                    }}
                  >
                    Balance: {commas(tokenBalance / SATS)}
                  </button>
                )}
              </>
            }
          >
            <AmountInput
              value={
                editSide === "token"
                  ? tokenAmount
                  : depTokenRaw > 0
                    ? fmtAmount(depTokenRaw / SATS)
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
                            Math.min(
                              Math.max(0, xcpBalance - (gasFee ?? 0)),
                              reserveToken > 0
                                ? Math.floor(
                                    ((tokenBalance ?? 0) * reserveXcp) /
                                      reserveToken,
                                  )
                                : xcpBalance,
                            ) / SATS,
                          ),
                        );
                      }}
                    >
                      Balance: {commas(xcpBalance / SATS)}
                    </button>
                  )}
                </>
              }
            >
              <AmountInput
                value={
                  editSide === "xcp"
                    ? xcpAmount
                    : depXcpRaw > 0
                      ? fmtAmount(depXcpRaw / SATS)
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
                title="Invert rate"
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
                    {commas((depositQuote.quantity_minted_estimate ?? 0) / SATS)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt title="Below this the transaction is void — nothing is debited">
                    Min LP · slippage {lqSlippage}%
                  </dt>
                  <dd className="tabular-nums">
                    {commas(
                      Math.floor(
                        (depositQuote.quantity_minted_estimate ?? 0) *
                          (1 - tolerance),
                      ) / SATS,
                    )}
                  </dd>
                </div>
                {lpSupply > 0 && (
                  <div className="flex justify-between">
                    <dt>Share of pool</dt>
                    <dd className="tabular-nums">
                      {pctFmt(
                        ((depositQuote.quantity_minted_estimate ?? 0) /
                          (lpSupply +
                            (depositQuote.quantity_minted_estimate ?? 0))) *
                          100,
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
          {(lpBalance ?? 0) > 0 && lpSupply > 0 && (
            <p className="px-2 pt-2 text-xs text-gray-500">
              Your position:{" "}
              <span className="font-medium text-gray-700">
                {commas(
                  Math.floor(((lpBalance ?? 0) * reserveToken) / lpSupply) /
                    SATS,
                )}{" "}
                {asset}
                {" + "}
                {commas(
                  Math.floor(((lpBalance ?? 0) * reserveXcp) / lpSupply) / SATS,
                )}{" "}
                XCP
              </span>{" "}
              · {pctFmt(((lpBalance ?? 0) / lpSupply) * 100)} of the pool
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
                  {commas((lpBalance ?? 0) / SATS)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>You receive (est.)</dt>
                <dd className="text-right font-medium tabular-nums text-gray-700">
                  {commas(outTokenRaw / SATS)} {asset}
                  <br />
                  {commas(outXcpRaw / SATS)} XCP
                  {xcpUsd && outXcpRaw > 0 ? (
                    <span className="font-normal text-gray-400">
                      {" "}
                      (≈{usdFmt((outXcpRaw / SATS) * xcpUsd)})
                    </span>
                  ) : null}
                </dd>
              </div>
              {outTokenRaw > 0 && (
                <div className="flex justify-between">
                  <dt title="Below this the transaction is void — nothing is debited">
                    Min received · slippage {lqSlippage}%
                  </dt>
                  <dd className="text-right tabular-nums">
                    {commas(Math.floor(outTokenRaw * (1 - tolerance)) / SATS)}{" "}
                    {asset}
                    <br />
                    {commas(Math.floor(outXcpRaw * (1 - tolerance)) / SATS)} XCP
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
          <ErrorBanner className="mb-2">{compose.error}</ErrorBanner>
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
                : lpToRemove === 0
                  ? (lpBalance ?? 0) === 0
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
