"use client";

import { useState } from "react";
import type { Dispenser } from "@/lib/api/counterparty";
import { commas, shortAddress, usd as usdFmt } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";

const SATS = 1e8;

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

  if (dispensers.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        No open XCP dispensers right now — check the DEX or try again later.
      </p>
    );
  }

  const d = dispensers[Math.min(selected, dispensers.length - 1)];
  const maxTriggers = Math.max(1, Math.floor(d.give_remaining / d.give_quantity));
  const n = Math.max(1, Math.min(maxTriggers, Math.floor(triggers) || 1));
  const xcpOut = (n * d.give_quantity) / SATS;
  const btcSats = n * d.satoshirate;
  const btc = btcSats / SATS;

  const presets = [1, 5, 10].map((target) => {
    const k = Math.max(1, Math.min(maxTriggers, Math.round((target * SATS) / d.give_quantity)));
    return { label: `~${target} XCP`, k };
  });

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
        value={selected}
        onChange={(e) => {
          setSelected(Number(e.target.value));
          setTriggers(1);
        }}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500"
      >
        {dispensers.map((disp, i) => (
          <option key={disp.source} value={i}>
            {Math.round(disp.price).toLocaleString()} sats/XCP
            {btcUsd ? ` (≈${usdFmt((disp.price / SATS) * btcUsd)})` : ""} ·{" "}
            {commas(disp.give_remaining / SATS)} XCP left · {shortAddress(disp.source)}
          </option>
        ))}
      </select>

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
          {xcpUsd ? (
            <span className="text-gray-400"> (≈{usdFmt(xcpOut * xcpUsd)})</span>
          ) : null}
          <br />
          for{" "}
          <span className="font-semibold text-gray-900">{btc.toFixed(8)} BTC</span>
          {btcUsd ? (
            <span className="text-gray-400"> (≈{usdFmt(btc * btcUsd)})</span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setTriggers(p.k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              n === p.k
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
