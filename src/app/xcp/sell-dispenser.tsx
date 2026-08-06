"use client";

import { useState } from "react";
import useSWR from "swr";
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

interface OwnDispenser {
  give_remaining: number;
  satoshirate: number;
  give_quantity: number;
}

/**
 * The other side of the vending machine: escrow your XCP at your price and
 * the protocol sells it for you — BTC arrives at your address with every
 * vend, no counterparty, no custody. Fixed to 1-XCP units so the dispenser
 * appears in this site's own buy list (which filters to single-unit
 * vendors). One open dispenser per asset per address; close any time to
 * reclaim whatever hasn't vended.
 */
export function SellDispenser({
  btcUsd,
  xcpUsd,
}: {
  btcUsd: number | null;
  xcpUsd: number | null;
}) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();

  const marketSats =
    btcUsd && xcpUsd ? Math.round((xcpUsd / btcUsd) * SATS) : null;
  const [escrow, setEscrow] = useState("");
  const [price, setPrice] = useState(""); // sats per XCP; prefilled lazily

  const { data: balance } = useSWR(
    address ? [address, "XCP", "sell-balance"] : null,
    async ([addr]) => {
      const data = await fetchJson(
        `${COUNTERPARTY_API_BASE}/addresses/${addr}/balances/XCP`,
      );
      const rows: { quantity: number }[] = Array.isArray(data.result)
        ? data.result
        : data.result
          ? [data.result]
          : [];
      return rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    },
    { refreshInterval: 30_000 },
  );

  const { data: existing, mutate: refreshExisting } = useSWR<OwnDispenser | null>(
    address ? [address, "own-dispenser"] : null,
    async ([addr]) => {
      const data = await fetchJson(
        `${COUNTERPARTY_API_BASE}/addresses/${addr}/dispensers?status=open`,
      );
      const rows: (OwnDispenser & { asset: string })[] = data.result ?? [];
      return rows.find((d) => d.asset === "XCP") ?? null;
    },
    { refreshInterval: 30_000 },
  );

  const priceSats =
    Math.round(parseFloat(price)) || (marketSats ?? 0);
  const escrowRaw = Math.round((parseFloat(escrow) || 0) * SATS);
  const perXcpUsd = btcUsd ? (priceSats / SATS) * btcUsd : null;
  const vsMarket =
    perXcpUsd && xcpUsd ? (perXcpUsd / xcpUsd - 1) * 100 : null;

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";
  const ready =
    escrowRaw >= SATS && priceSats > 0 && !busy && !existing;

  const open = () =>
    compose.composeDispenser({
      asset: "XCP",
      give_quantity: SATS, // 1 XCP per vend — matches the buy list's filter
      escrow_quantity: escrowRaw,
      mainchainrate: priceSats,
      status: 0,
    });

  const close = () =>
    compose.composeDispenser({
      asset: "XCP",
      give_quantity: 0,
      escrow_quantity: 0,
      mainchainrate: 0,
      status: 10,
    });

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">Dispenser broadcast</div>
        <p className="mt-1 text-green-700">
          Takes effect when it confirms.{" "}
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
          onClick={() => {
            compose.reset();
            refreshExisting();
          }}
          className="mt-2 text-green-800 underline"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      {existing ? (
        <>
          <p className="text-sm text-gray-700">
            You already have an open XCP dispenser:{" "}
            <span className="font-semibold">
              {commas(existing.give_remaining / SATS)} XCP left
            </span>{" "}
            at{" "}
            <span className="font-semibold">
              {Math.round(
                (existing.satoshirate / existing.give_quantity) * SATS,
              ).toLocaleString()}{" "}
              sats/XCP
            </span>
            . One per asset per address — close it to reclaim the rest or
            change your price.
          </p>
          {compose.status === "error" && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {compose.error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="mt-3 w-full rounded-md border border-gray-300 px-5 py-2.5 font-medium text-gray-700 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
          >
            {busy ? "Working…" : "Close dispenser & reclaim"}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label
                htmlFor="sell-escrow"
                className="flex justify-between text-xs text-gray-500"
              >
                <span>XCP to escrow</span>
                {balance !== undefined && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setEscrow(String(balance / SATS))}
                  >
                    max {commas(balance / SATS)}
                  </button>
                )}
              </label>
              <input
                id="sell-escrow"
                type="number"
                min={1}
                step="any"
                value={escrow}
                onChange={(e) => setEscrow(e.target.value)}
                placeholder="0"
                className="mt-1 block w-full rounded-md border border-gray-300 p-3 text-lg outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="sell-price" className="text-xs text-gray-500">
                Price (sats per XCP)
              </label>
              <input
                id="sell-price"
                type="number"
                min={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={marketSats ? String(marketSats) : "0"}
                className="mt-1 block w-full rounded-md border border-gray-300 p-3 text-lg outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {perXcpUsd && xcpUsd && vsMarket !== null && (
            <p className="mt-2 text-xs text-gray-500">
              Your price: ≈{usdFmt(perXcpUsd)}/XCP · market ≈{usdFmt(xcpUsd)}
              /XCP ·{" "}
              <span
                className={
                  Math.abs(vsMarket) < 0.5
                    ? "font-medium text-gray-600"
                    : vsMarket > 0
                      ? "font-medium text-green-600"
                      : "font-medium text-amber-600"
                }
              >
                {Math.abs(vsMarket) < 0.5
                  ? "at market"
                  : vsMarket > 0
                    ? `${vsMarket.toFixed(0)}% above market — your premium`
                    : `${Math.abs(vsMarket).toFixed(0)}% below market — vends fast, earns less`}
              </span>
            </p>
          )}

          <p className="mt-2 text-xs text-gray-500">
            Vends 1 XCP at a time (the format this site lists). BTC arrives
            at your address automatically with every vend — no counterparty,
            no custody. Close any time to reclaim whatever hasn&apos;t sold.
          </p>

          {compose.status === "error" && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {compose.error}
            </p>
          )}

          {walletStatus !== "connected" ? (
            <button
              type="button"
              onClick={() => connect()}
              className="mt-4 w-full rounded-md bg-gray-900 px-5 py-3 font-medium text-white hover:bg-gray-700"
            >
              {walletStatus === "not_detected"
                ? "Install XCP Wallet"
                : "Connect Wallet"}
            </button>
          ) : (
            <button
              type="button"
              disabled={!ready}
              onClick={open}
              className="mt-4 w-full rounded-md bg-purple-600 px-5 py-3 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? compose.status === "signing"
                  ? "Confirm in wallet…"
                  : "Working…"
                : escrowRaw >= SATS
                  ? `Open dispenser — sell ${commas(escrowRaw / SATS)} XCP`
                  : "Open dispenser"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
