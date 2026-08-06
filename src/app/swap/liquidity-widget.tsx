"use client";

import { useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { commas, usd as usdFmt } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;

const fetchJson = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

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
 * Liquidity on top of the locked floor. The launch LP is burned forever —
 * that liquidity can never leave. Anything YOU add mints LP to your
 * address, earns the 50 bps swap fee while it's in, and withdraws whenever
 * you like. Deposits are proportional: quote one side, the protocol takes
 * matching amounts of both.
 */
export function LiquidityWidget({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [asset, setAsset] = useState(assets[0] ?? "");
  const [tab, setTab] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState(""); // token units, add tab
  const [pct, setPct] = useState(25); // remove tab

  const { data: pool } = useSWR<PoolInfo | null>(
    asset ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP` : null,
    (url: string) => fetchJson(url).then((d) => d.result ?? null),
    { refreshInterval: 30_000 },
  );
  const amountRaw = Math.round((parseFloat(amount) || 0) * SATS);
  const { data: depositQuote } = useSWR<DepositQuote>(
    tab === "add" && asset && amountRaw > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/deposit?quantity=${amountRaw}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 15_000 },
  );
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

  const { data: lpBalance } = useSWR(
    address && pool?.lp_asset
      ? `${COUNTERPARTY_API_BASE}/addresses/${address}/balances/${pool.lp_asset}`
      : null,
    (url: string) =>
      fetchJson(url).then((d) => {
        const rows: { quantity: number }[] = Array.isArray(d.result)
          ? d.result
          : d.result
            ? [d.result]
            : [];
        return rows.reduce((s: number, r) => s + (r.quantity ?? 0), 0);
      }),
    { refreshInterval: 30_000 },
  );
  const lpToRemove = Math.floor(((lpBalance ?? 0) * pct) / 100);

  const { data: withdrawQuote } = useSWR<WithdrawQuote>(
    tab === "remove" && asset && lpToRemove > 0
      ? `${COUNTERPARTY_API_BASE}/pools/${asset}/XCP/quote/withdraw?quantity=${lpToRemove}`
      : null,
    (url: string) => fetchJson(url).then((d) => d.result),
    { refreshInterval: 15_000 },
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

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";

  const addReady =
    tab === "add" && amountRaw > 0 && depTokenRaw > 0 && depXcpRaw > 0 && !busy;
  const removeReady = tab === "remove" && lpToRemove > 0 && !busy;

  const submitAdd = () => {
    if (!addReady || !depositQuote) return;
    compose.composePoolDeposit({
      asset_a: asset,
      asset_b: "XCP",
      quantity_a: depTokenRaw,
      quantity_b: depXcpRaw,
      min_lp_quantity: Math.floor((depositQuote.quantity_minted_estimate ?? 0) * 0.99),
    });
  };

  const submitRemove = () => {
    if (!removeReady || !pool) return;
    compose.composePoolWithdraw({
      lp_asset: pool.lp_asset,
      quantity: lpToRemove,
      min_quantity_a: Math.floor(((withdrawQuote?.quantity_a_estimate ?? 0) * 99) / 100),
      min_quantity_b: Math.floor(((withdrawQuote?.quantity_b_estimate ?? 0) * 99) / 100),
    });
  };

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">
          {tab === "add" ? "Deposit broadcast" : "Withdrawal broadcast"}
        </div>
        <p className="mt-1 text-green-700">
          Settles when it confirms.{" "}
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
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <TokenImage
            asset={asset}
            className="size-10 rounded-full bg-gray-100 object-cover"
          />
          <select
            value={asset}
            onChange={(e) => {
              setAsset(e.target.value);
              setAmount("");
            }}
            aria-label="Pool"
            className="block flex-1 rounded-md border border-gray-300 bg-white p-2.5 text-sm font-medium outline-none focus:border-purple-500"
          >
            {assets.map((a) => (
              <option key={a} value={a}>
                {a} / XCP pool
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
          {(["add", "remove"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 capitalize ${
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
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="lq-amount" className="text-xs text-gray-500">
                {asset} to deposit
              </label>
              <input
                id="lq-amount"
                type="number"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="mt-1 block w-full rounded-md border border-gray-300 p-3 text-lg outline-none focus:border-purple-500"
              />
            </div>
            {depositQuote && amountRaw > 0 && !depositQuote.first_deposit && (
              <dl className="space-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-600">
                <div className="flex justify-between">
                  <dt>Paired XCP required</dt>
                  <dd className="font-semibold text-gray-900">
                    {commas(depXcpRaw / SATS)} XCP
                    {xcpUsd ? (
                      <span className="font-normal text-gray-400">
                        {" "}
                        (≈{usdFmt((depXcpRaw / SATS) * xcpUsd)})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>LP tokens minted (est.)</dt>
                  <dd className="font-semibold text-gray-900">
                    {commas((depositQuote.quantity_minted_estimate ?? 0) / SATS)}
                  </dd>
                </div>
              </dl>
            )}
            <p className="text-xs text-gray-500">
              Deposits are proportional at the current price — both sides move
              together. Your LP earns the 50 bps fee on every swap while
              it&apos;s in, and withdraws whenever you like.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between text-xs text-gray-500">
              <span>Amount to remove</span>
              <span className="text-2xl font-bold text-gray-900">{pct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="ui-slider w-full"
              aria-label="Percent of LP to remove"
            />
            <div className="flex items-center gap-2">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
                    pct === p
                      ? "border-purple-600 bg-purple-50 text-purple-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {p === 100 ? "MAX" : `${p}%`}
                </button>
              ))}
            </div>
            <dl className="space-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <dt>Your LP balance</dt>
                <dd className="font-semibold text-gray-900">
                  {commas((lpBalance ?? 0) / SATS)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>You will receive (est.)</dt>
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
            </dl>
            <p className="text-xs text-gray-500">
              Only liquidity you added can leave — the launch liquidity is
              burned at the unspendable address and stays forever.
            </p>
          </div>
        )}

        {compose.status === "error" && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {compose.error}
          </p>
        )}

        {walletStatus !== "connected" ? (
          <button
            type="button"
            onClick={() => connect()}
            className="mt-4 w-full rounded-xl bg-gray-900 px-5 py-3 font-medium text-white hover:bg-gray-700"
          >
            {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
          </button>
        ) : (
          <button
            type="button"
            disabled={tab === "add" ? !addReady : !removeReady}
            onClick={tab === "add" ? submitAdd : submitRemove}
            className="mt-4 w-full rounded-xl bg-purple-600 px-5 py-3 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? compose.status === "signing"
                ? "Confirm in wallet…"
                : "Working…"
              : tab === "add"
                ? "Add liquidity"
                : "Remove liquidity"}
          </button>
        )}
      </div>
    </div>
  );
}
