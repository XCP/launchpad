"use client";

import { useState } from "react";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { XCP69 } from "@/lib/xcp69";

const MAX_LOTS = XCP69.MAX_MINT_PER_ADDRESS / XCP69.QUANTITY_BY_PRICE; // 690
const XCP_PER_LOT = XCP69.PRICE / 1e8; // 0.01

/** Fixed-lot mint: pick a lot count, pay lots × 0.01 XCP, escrowed until close. */
export function MintPanel({ asset }: { asset: string }) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [lots, setLots] = useState(10);

  const clampedLots = Math.max(1, Math.min(MAX_LOTS, Math.floor(lots) || 1));
  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">
          Mint broadcast — {(clampedLots * 1000).toLocaleString()} {asset} for{" "}
          {(clampedLots * XCP_PER_LOT).toFixed(2)} XCP
        </div>
        <p className="mt-1 text-green-700">
          Escrowed until the launch resolves: tokens if it sells out, full XCP
          refund if it doesn&apos;t.{" "}
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
          Mint again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Mint</h2>
      <div className="mt-3 flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="lots" className="text-xs text-gray-500">
            Lots (1,000 tokens each · max {MAX_LOTS} per address)
          </label>
          <input
            id="lots"
            type="number"
            min={1}
            max={MAX_LOTS}
            value={lots}
            onChange={(e) => setLots(Number(e.target.value))}
            className="mt-1 block w-full rounded-md border border-gray-300 p-2.5 outline-none focus:border-purple-500"
          />
        </div>
        <div className="pb-1 text-sm text-gray-600">
          = {(clampedLots * 1000).toLocaleString()} {asset}
          <br />
          costs{" "}
          <span className="font-semibold text-gray-900">
            {(clampedLots * XCP_PER_LOT).toFixed(2)} XCP
          </span>
        </div>
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
            compose.composeFairmint({
              asset,
              quantity: clampedLots * XCP69.QUANTITY_BY_PRICE,
            })
          }
          className="mt-4 w-full rounded-md bg-purple-600 px-5 py-2.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {compose.status === "composing" && "Composing…"}
          {compose.status === "signing" && "Confirm in wallet…"}
          {compose.status === "broadcasting" && "Broadcasting…"}
          {(compose.status === "idle" || compose.status === "error") &&
            `Mint from ${address?.slice(0, 8)}…`}
        </button>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Your XCP is escrowed by the protocol, not sent to the creator. If the
        launch misses its target, every mint is automatically refunded.
      </p>
    </div>
  );
}
