"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { ConfirmCard, TxLink } from "@/components/ui/confirm-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usd } from "@/lib/format";
import { isBusy } from "@/lib/use-busy";
import { registerPending } from "@/lib/pending";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { XCP69 } from "@/lib/xcp69";

const MAX_LOTS = XCP69.MAX_MINT_PER_ADDRESS / XCP69.QUANTITY_BY_PRICE; // 1000
const XCP_PER_LOT = XCP69.PRICE / 1e8; // 0.01

/** Fixed-lot mint: pick a lot count, pay lots × 0.01 XCP, escrowed until close. */
export function MintPanel({
  asset,
  xcpUsd = null,
}: {
  asset: string;
  xcpUsd?: number | null;
}) {
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const [lots, setLots] = useState(10);

  const clampedLots = Math.max(1, Math.min(MAX_LOTS, Math.floor(lots) || 1));
  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "confirmed") {
      registerPending({
        txid: compose.txid,
        kind: "mint",
        label: `Mint ${(clampedLots * 1000).toLocaleString()} ${asset}`,
        address: address ?? undefined,
      });
    }
  }, [compose.status, compose.txid, clampedLots, asset, address]);


  if (compose.status === "confirmed") {
    return (
      <ConfirmCard
        title={`Mint broadcast — ${(clampedLots * 1000).toLocaleString()} ${asset} for ${(clampedLots * XCP_PER_LOT).toFixed(2)} XCP`}
        onReset={compose.reset}
        resetLabel="Mint again"
      >
        <p className="mt-1 text-green-700">
          Escrowed until the launch resolves: tokens if it sells out, full XCP
          refund if it doesn&apos;t. <TxLink txid={compose.txid} />
        </p>
      </ConfirmCard>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold">Mint</h2>
      <div className="mt-3 flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="lots" className="text-xs text-gray-500">
            Lots (1,000 tokens each · max {MAX_LOTS} per address)
          </label>
          <input
            id="lots"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={lots}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, "");
              setLots(v === "" ? 0 : Number(v));
            }}
            className="mt-1 block w-full rounded-xl border border-gray-300 p-2.5 outline-none transition-colors focus:border-purple-500"
          />
        </div>
        <div className="pb-1 text-sm text-gray-600">
          = {(clampedLots * 1000).toLocaleString()} {asset}
          <br />
          costs{" "}
          <span className="font-semibold text-gray-900">
            {(clampedLots * XCP_PER_LOT).toFixed(2)} XCP
          </span>
          {xcpUsd && (
            <span className="text-gray-400">
              {" "}
              ≈{usd(clampedLots * XCP_PER_LOT * xcpUsd)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {[10, 100, MAX_LOTS].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setLots(preset)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              clampedLots === preset
                ? "border-purple-600 bg-purple-50 text-purple-700"
                : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            {preset === MAX_LOTS
              ? "Max (10 XCP)"
              : `${(preset * XCP_PER_LOT).toLocaleString()} XCP`}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">
          ={" "}
          {(clampedLots / 1000).toLocaleString("en-US", {
            maximumFractionDigits: 3,
          })}
          % of supply
        </span>
      </div>

      {compose.status === "error" && (
          <ErrorBanner className="mt-3">{compose.error}</ErrorBanner>
        )}

      {walletStatus !== "connected" ? (
        <ConnectButton size="md" className="mt-4" />
      ) : (
        <CTA
          size="md"
          className="mt-4"
          disabled={busy}
          onClick={() =>
            compose.composeFairmint({
              asset,
              quantity: clampedLots * XCP69.QUANTITY_BY_PRICE,
            })
          }
        >
          {compose.status === "composing" && "Composing…"}
          {compose.status === "signing" && "Confirm in wallet…"}
          {compose.status === "broadcasting" && "Broadcasting…"}
          {(compose.status === "idle" || compose.status === "error") &&
            `Mint from ${address?.slice(0, 8)}…`}
        </CTA>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Your XCP is escrowed by the protocol, not sent to the creator. If the
        launch misses its target, every mint is automatically refunded. Need
        XCP?{" "}
        <Link href="/xcp" className="text-purple-600 underline">
          Get some here
        </Link>
        .
      </p>
    </div>
  );
}
