"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { TokenImage } from "@/components/token-image";
import { TokenSelectModal } from "@/components/token-select-modal";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { ConfirmCard, TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { GearPopover } from "@/components/ui/popover";
import { Well } from "@/components/ui/well";
import { commas, usd as usdFmt } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { registerPending } from "@/lib/pending";
import { isBusy } from "@/lib/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { fetchBalance, fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;
/**
 * Liquidity slippage is looser than swap slippage by industry convention
 * (deposits/withdrawals drift with every pool trade), and a breach here is
 * benign: the transaction is simply invalid — nothing debited, no XCP gas
 * charged, only the BTC miner fee spent.
 */
const SLIPPAGE_PRESETS = [0.5, 1, 2.5];
const DEFAULT_SLIPPAGE = 2.5;

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
 * and withdraws whenever you like.
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
  const [amount, setAmount] = useState(""); // token units, add tab
  const [pct, setPct] = useState(25); // remove tab
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [slippagePreset, setSlippagePreset] = useState(DEFAULT_SLIPPAGE);
  const [customSlippage, setCustomSlippage] = useState("");

  const customSlip = Math.min(parseFloat(customSlippage) || 0, 50);
  const slippage = customSlip > 0 ? customSlip : slippagePreset;
  const tolerance = slippage / 100;

  const { data: pool } = useSWR<PoolInfo | null>(
    asset ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP` : null,
    (url: string) => fetchJson(url).then((d) => d.result ?? null),
    { refreshInterval: 30_000 },
  );

  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);
  const debouncedRaw = useDebounced(amountRaw, 250);
  const { data: depositQuote, isValidating: depFetching } = useSWR<DepositQuote>(
    tab === "add" && asset && debouncedRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/deposit?quantity=${debouncedRaw}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 15_000, keepPreviousData: true },
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
  const lpToRemove = Math.floor(((lpBalance ?? 0) * pct) / 100);
  const debouncedLp = useDebounced(lpToRemove, 250);

  const { data: withdrawQuote } = useSWR<WithdrawQuote>(
    tab === "remove" && asset && debouncedLp > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/withdraw?quantity=${debouncedLp}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 15_000, keepPreviousData: true },
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


  const insufficientToken =
    tokenBalance !== undefined && amountRaw > 0 && amountRaw > tokenBalance;
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
    });
  };

  if (compose.status === "confirmed") {
    return (
      <ConfirmCard
        title={tab === "add" ? "Deposit broadcast" : "Withdrawal broadcast"}
        onReset={compose.reset}
        resetLabel="Done"
      >
        <p className="mt-1 text-green-700">
          Settles when it confirms. <TxLink txid={compose.txid} />
        </p>
      </ConfirmCard>
    );
  }

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

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      <div className="p-2">
        <div className="relative flex items-center gap-2">
          {assets.length === 1 ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 p-2 pr-3">
              <TokenImage
                asset={asset}
                className="size-10 rounded-full bg-gray-100 object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-gray-900">
                {asset} / XCP pool
              </span>
            </div>
          ) : (
          <button
            type="button"
            onClick={() => setSelectorOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-gray-200 bg-white p-2 pr-3 transition-all hover:border-gray-300 hover:shadow-sm active:scale-[0.99]"
          >
            <TokenImage
              asset={asset}
              className="size-10 rounded-full bg-gray-100 object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-gray-900">
              {asset} / XCP pool
            </span>
            <span aria-hidden className="text-xs text-gray-400">
              ▾
            </span>
          </button>
          )}
          <GearPopover active={customSlip > 0} label="Liquidity settings">
                <div className="text-xs font-medium text-gray-500">
                  Max slippage
                </div>
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
                      customSlip > 0
                        ? "border-purple-600 bg-purple-50"
                        : "border-gray-200"
                    }`}
                  >
                    <AmountInput
                      value={customSlippage}
                      onChange={setCustomSlippage}
                      placeholder="5"
                      ariaLabel="Custom slippage percent"
                      className="w-8 bg-transparent text-right text-xs font-medium outline-none"
                    />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                </div>
                <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
                  If the pool moves past this before confirmation, the whole
                  transaction is void — nothing is debited; only the miner fee
                  is spent.
                </div>
          </GearPopover>
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-sm font-medium">
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
          <div className="mt-3 space-y-3">
            <Well
              focusable
              label={<label htmlFor="lq-amount">{asset} to deposit</label>}
              topRight={
                tokenBalance !== undefined && (
                  <button
                    type="button"
                    className="hover:text-gray-700 hover:underline"
                    onClick={() =>
                      setAmount(
                        (tokenBalance / SATS).toFixed(8).replace(/\.?0+$/, ""),
                      )
                    }
                  >
                    Balance: {commas(tokenBalance / SATS)}
                  </button>
                )
              }
            >
              <AmountInput
                id="lq-amount"
                value={amount}
                onChange={setAmount}
                className={`w-full min-w-0 bg-transparent text-2xl font-semibold outline-none placeholder:text-gray-300 ${
                  insufficientToken ? "text-red-600" : "text-gray-900"
                }`}
              />
            </Well>
            {depositQuote && amountRaw > 0 && !depositQuote.first_deposit && (
              <dl
                className="space-y-1 rounded-2xl bg-gray-50 p-3 text-xs text-gray-600"
                style={{
                  filter: depStale ? "grayscale(1)" : "none",
                  opacity: depStale ? 0.5 : 1,
                  transition: depStale ? "none" : "opacity 250ms ease-in-out",
                }}
              >
                <div className="flex justify-between">
                  <dt>Paired XCP (max)</dt>
                  <dd
                    className={`font-semibold ${insufficientXcp ? "text-red-600" : "text-gray-900"}`}
                  >
                    {commas(depXcpRaw / SATS)} XCP
                    {xcpUsd ? (
                      <span className="font-normal text-gray-400">
                        {" "}
                        (≈{usdFmt((depXcpRaw / SATS) * xcpUsd)})
                      </span>
                    ) : null}
                  </dd>
                </div>
                {xcpBalance !== undefined && (
                  <div className="flex justify-between">
                    <dt>Your XCP</dt>
                    <dd>{commas(xcpBalance / SATS)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>LP minted (est.)</dt>
                  <dd className="font-semibold text-gray-900">
                    {commas((depositQuote.quantity_minted_estimate ?? 0) / SATS)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt title="Below this the transaction is void — nothing is debited">
                    Min LP · slippage {slippage}%
                  </dt>
                  <dd>
                    {commas(
                      Math.floor(
                        (depositQuote.quantity_minted_estimate ?? 0) *
                          (1 - tolerance),
                      ) / SATS,
                    )}
                  </dd>
                </div>
                {(gasFee ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <dt>Protocol gas fee</dt>
                    <dd>{commas((gasFee ?? 0) / SATS)} XCP</dd>
                  </div>
                )}
              </dl>
            )}
            <p className="px-1 text-xs text-gray-500">
              Amounts are maximums — the largest proportional deposit is taken
              and any excess never leaves your wallet. Your LP earns the 50 bps
              fee on every swap.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
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
                {[25, 50, 75, 100].map((p) => (
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
            <dl className="space-y-1 rounded-2xl bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <dt>Your LP balance</dt>
                <dd className="font-semibold text-gray-900">
                  {commas((lpBalance ?? 0) / SATS)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>You receive (est.)</dt>
                <dd className="text-right font-semibold text-gray-900">
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
                    Min received · slippage {slippage}%
                  </dt>
                  <dd className="text-right">
                    {commas(Math.floor(outTokenRaw * (1 - tolerance)) / SATS)}{" "}
                    {asset}
                    <br />
                    {commas(Math.floor(outXcpRaw * (1 - tolerance)) / SATS)} XCP
                  </dd>
                </div>
              )}
              {(gasFee ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt>Protocol gas fee</dt>
                  <dd>{commas((gasFee ?? 0) / SATS)} XCP</dd>
                </div>
              )}
            </dl>
            <p className="px-1 text-xs text-gray-500">
              Only liquidity you added can leave — the launch liquidity is
              burned and stays forever.
            </p>
          </div>
        )}

        {compose.status === "error" && (
          <ErrorBanner className="mt-3">{compose.error}</ErrorBanner>
        )}

        {walletStatus !== "connected" ? (
          <ConnectButton className="mt-3" />
        ) : (
          <CTA
            className="mt-3"
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
          setAmount("");
        }}
      />
    </div>
  );
}
