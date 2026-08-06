"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Dispenser } from "@/lib/api/counterparty";
import { commas, compact, shortAddress, usd as usdFmt } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { XCP69 } from "@/lib/xcp69";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;
/** 1 XCP mints 100,000 tokens of any launch (lot size ÷ lot price). */
const TOKENS_PER_XCP = XCP69.QUANTITY_BY_PRICE / XCP69.PRICE;

/**
 * Dispenser addresses with a dispense already pending in the mempool. A
 * pending trigger can drain the escrow before yours confirms — and your BTC
 * still goes to the dispenser with nothing vended and no refund path. Hide
 * those dispensers until the mempool clears.
 */
async function fetchBusyDispensers(): Promise<Set<string>> {
  const res = await fetch(
    `${COUNTERPARTY_API_BASE}/mempool/events/DISPENSE?limit=500`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const events: { params?: { source?: string } }[] = (await res.json()).result ?? [];
  return new Set(
    events.map((e) => e.params?.source).filter((s): s is string => Boolean(s)),
  );
}

/**
 * One dispenser, one transaction: dispensers vend fixed units (k ×
 * give_quantity per k × satoshirate of BTC sent), so the honest UX is a
 * dispenser picker (cheapest preselected) and a quantity in that
 * dispenser's own units — not a fake "any amount" field that would need
 * multiple transactions behind the user's back.
 */
export function DispenserBuy({
  dispensers,
  btcUsd,
  xcpUsd,
}: {
  dispensers: Dispenser[];
  btcUsd: number | null;
  xcpUsd: number | null;
}) {
  const { status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [selected, setSelected] = useState(0);
  const [triggers, setTriggers] = useState(1);

  const { data: pendingSources } = useSWR("mempool-dispenses", fetchBusyDispensers, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
  const open = dispensers.filter((disp) => !pendingSources?.has(disp.source));
  const hiddenCount = dispensers.length - open.length;

  if (open.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        {dispensers.length > 0
          ? "Every open dispenser has a purchase pending in the mempool — check back in a few minutes."
          : "No open XCP dispensers right now — check the DEX or try again later."}
      </p>
    );
  }

  const d = open[Math.min(selected, open.length - 1)];
  const maxTriggers = Math.max(1, Math.floor(d.give_remaining / d.give_quantity));
  const n = Math.max(1, Math.min(maxTriggers, Math.floor(triggers) || 1));
  const xcpOut = (n * d.give_quantity) / SATS;
  const btcSats = n * d.satoshirate;
  const btc = btcSats / SATS;

  const presets = [1, 5, 10, 100].map((target) => {
    const k = Math.max(1, Math.round((target * SATS) / d.give_quantity));
    const exact = k * d.give_quantity === target * SATS;
    return {
      label: exact ? `${target} XCP` : `~${target} XCP`,
      k,
      available: k <= maxTriggers,
    };
  });

  // The deal, relative to market: dispenser rate in USD vs the XCP spot.
  const perXcpUsd = btcUsd ? (d.satoshirate / d.give_quantity) * btcUsd : null;
  const vsMarket =
    perXcpUsd && xcpUsd ? (perXcpUsd / xcpUsd - 1) * 100 : null;

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">
          Dispense broadcast — {commas(xcpOut)} XCP incoming
        </div>
        <p className="mt-1 text-green-700">
          The dispenser vends automatically when your BTC confirms; the XCP
          lands on your address&apos;s Counterparty balance, ready to mint
          with.{" "}
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
          Buy more
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <label htmlFor="dispenser" className="text-xs text-gray-500">
        Dispenser (cheapest first)
      </label>
      <select
        id="dispenser"
        value={Math.min(selected, open.length - 1)}
        onChange={(e) => {
          setSelected(Number(e.target.value));
          setTriggers(1);
        }}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500"
      >
        {open.map((disp, i) => (
          <option key={disp.source} value={i}>
            {Math.round(disp.price).toLocaleString()} sats/XCP
            {btcUsd ? ` (≈${usdFmt((disp.price / SATS) * btcUsd)})` : ""} ·{" "}
            {commas(disp.give_remaining / SATS)} XCP left · {shortAddress(disp.source)}
          </option>
        ))}
      </select>
      {hiddenCount > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          {hiddenCount} dispenser{hiddenCount === 1 ? "" : "s"} temporarily
          hidden — a purchase is already pending in the mempool, and a second
          buyer could get nothing for their BTC.
        </p>
      )}

      <div className="mt-3 flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="triggers" className="text-xs text-gray-500">
            Units ({commas(d.give_quantity / SATS)} XCP each · max {maxTriggers})
          </label>
          <input
            id="triggers"
            type="number"
            min={1}
            max={maxTriggers}
            value={triggers}
            onChange={(e) => setTriggers(Number(e.target.value))}
            className="mt-1 block w-full rounded-md border border-gray-300 p-2.5 outline-none focus:border-purple-500"
          />
        </div>
        <div className="pb-1 text-sm text-gray-600">
          = <span className="font-semibold text-gray-900">{commas(xcpOut)} XCP</span>
          <span className="text-gray-400">
            {" "}
            · mints {compact(xcpOut * TOKENS_PER_XCP)} tokens
          </span>
          <br />
          for{" "}
          <span className="font-semibold text-gray-900">{btc.toFixed(8)} BTC</span>
          {btcUsd ? (
            <span className="text-gray-400"> (≈{usdFmt(btc * btcUsd)})</span>
          ) : null}
        </div>
      </div>

      {perXcpUsd && xcpUsd && vsMarket !== null && (
        <p className="mt-1 text-xs text-gray-500">
          This dispenser: ≈{usdFmt(perXcpUsd)}/XCP · market ≈{usdFmt(xcpUsd)}/XCP ·{" "}
          <span
            className={
              vsMarket <= 0 ? "font-medium text-green-600" : "font-medium text-amber-600"
            }
          >
            {vsMarket <= 0
              ? `${Math.abs(vsMarket).toFixed(0)}% below market`
              : `${vsMarket.toFixed(0)}% above market`}
          </span>
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={!p.available}
            title={p.available ? undefined : "This dispenser doesn't have that much left"}
            onClick={() => setTriggers(p.k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              !p.available
                ? "cursor-not-allowed border-gray-200 text-gray-300"
                : n === p.k
                  ? "border-purple-600 bg-purple-50 text-purple-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {compose.status === "error" && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {compose.error}
        </p>
      )}

      {walletStatus !== "connected" ? (
        <button
          type="button"
          onClick={() => connect()}
          className="mt-4 w-full rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
        >
          {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            compose.composeDispense({ dispenser: d.source, quantity: btcSats })
          }
          className="mt-4 w-full rounded-md bg-purple-600 px-5 py-2.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {compose.status === "composing"
            ? "Composing…"
            : compose.status === "signing"
              ? "Confirm in wallet…"
              : compose.status === "broadcasting"
                ? "Broadcasting…"
                : `Buy ${commas(xcpOut)} XCP`}
        </button>
      )}
      <p className="mt-2 text-xs text-gray-500">
        You send BTC to the dispenser address; the protocol vends the XCP to
        you automatically when the transaction confirms. Non-custodial, no
        account — but unlike minting, a dispense is a purchase, not an escrow:
        there is no refund path.
      </p>
    </div>
  );
}
