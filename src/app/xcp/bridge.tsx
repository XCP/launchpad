"use client";

import { useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import type { Dispenser } from "@/lib/api/counterparty";
import { commas, compact, shortAddress, usd as usdFmt } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { XCP69 } from "@/lib/xcp69";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

const SATS = 1e8;
/** 1 XCP mints 100,000 tokens of any launch (lot size ÷ lot price). */
const TOKENS_PER_XCP = XCP69.QUANTITY_BY_PRICE / XCP69.PRICE;

const fetchJson = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

async function fetchBalance(address: string, asset: string): Promise<number> {
  const data = await fetchJson(
    `${COUNTERPARTY_API_BASE}/addresses/${address}/balances/${asset}`,
  );
  const rows: { quantity: number }[] = Array.isArray(data.result)
    ? data.result
    : data.result
      ? [data.result]
      : [];
  return rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
}

/**
 * Dispenser addresses with a dispense already pending in the mempool: a
 * pending trigger can drain the escrow before yours confirms, and the BTC
 * is forfeit. Hidden from routing until the mempool clears.
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

const btcChip = (
  <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm">
    <span className="flex size-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
      ₿
    </span>
    <span className="text-sm font-semibold">BTC</span>
  </div>
);

const xcpChip = (
  <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm">
    <span className="flex size-6 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
      X
    </span>
    <span className="text-sm font-semibold">XCP</span>
  </div>
);

function FlipNotch({ onFlip, flips }: { onFlip: () => void; flips: number }) {
  return (
    <div className="relative z-10 h-0.5">
      <button
        type="button"
        onClick={onFlip}
        aria-label="Switch direction"
        title="Switch direction"
        className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gray-50 text-gray-500 shadow-[0_0_0_4px_white] transition-transform duration-300 hover:bg-gray-100 hover:text-purple-600 active:scale-95"
        style={{ transform: `translate(-50%, -50%) rotate(${flips * 180}deg)` }}
      >
        ↓
      </button>
    </div>
  );
}

/**
 * The XCP bridge: dispensers aren't DEX orders — they're the on/off-ramp
 * between the Bitcoin side of your wallet and the Counterparty side. Load
 * sends BTC through the cheapest dispenser route and XCP lands next block;
 * Unload posts your XCP at your price and BTC arrives as it sells.
 */
export function XcpBridge({
  dispensers,
  btcUsd,
  xcpUsd,
}: {
  dispensers: Dispenser[];
  btcUsd: number | null;
  xcpUsd: number | null;
}) {
  const [direction, setDirection] = useState<"load" | "unload">("load");
  const [flips, setFlips] = useState(0);
  const flip = () => {
    setFlips((f) => f + 1);
    setDirection(direction === "load" ? "unload" : "load");
  };

  return direction === "load" ? (
    <LoadCard
      dispensers={dispensers}
      btcUsd={btcUsd}
      xcpUsd={xcpUsd}
      onFlip={flip}
      flips={flips}
    />
  ) : (
    <UnloadCard btcUsd={btcUsd} xcpUsd={xcpUsd} onFlip={flip} flips={flips} />
  );
}

/* ------------------------------------------------------------------ */
/* Load: BTC → XCP through a dispenser route                           */
/* ------------------------------------------------------------------ */

function LoadCard({
  dispensers,
  btcUsd,
  xcpUsd,
  onFlip,
  flips,
}: {
  dispensers: Dispenser[];
  btcUsd: number | null;
  xcpUsd: number | null;
  onFlip: () => void;
  flips: number;
}) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();
  const [routeIdx, setRouteIdx] = useState(0);
  const [amount, setAmount] = useState(""); // XCP to receive
  const [routeOpen, setRouteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const { data: pendingSources } = useSWR("mempool-dispenses", fetchBusyDispensers, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
  const open = dispensers.filter((disp) => !pendingSources?.has(disp.source));
  const hiddenCount = dispensers.length - open.length;

  const { data: xcpBalance } = useSWR(
    address ? [address, "XCP", "bridge-balance"] : null,
    ([addr]) => fetchBalance(addr, "XCP"),
    { refreshInterval: 30_000 },
  );

  const d = open[Math.min(routeIdx, Math.max(open.length - 1, 0))];
  const unitXcp = d ? d.give_quantity / SATS : 1;
  const maxUnits = d ? Math.max(1, Math.floor(d.give_remaining / d.give_quantity)) : 0;
  const typed = parseFloat(amount) || 0;
  const n = d ? Math.max(0, Math.min(maxUnits, Math.round(typed / unitXcp))) : 0;
  const snapped = n * unitXcp;
  const btcSats = d ? n * d.satoshirate : 0;
  const btc = btcSats / SATS;

  const presets = d
    ? [1, 5, 10, 100].map((target) => {
        const k = Math.max(1, Math.round((target * SATS) / d.give_quantity));
        return { label: `${target}`, k, available: k <= maxUnits };
      })
    : [];

  const perXcpUsd = d && btcUsd ? (d.satoshirate / d.give_quantity) * btcUsd : null;
  const vsMarket = perXcpUsd && xcpUsd ? (perXcpUsd / xcpUsd - 1) * 100 : null;

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";

  if (compose.status === "confirmed") {
    return (
      <div className="rounded-3xl border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">
          {commas(snapped)} XCP incoming
        </div>
        <p className="mt-1 text-green-700">
          Lands on your Counterparty balance the moment your BTC confirms —
          ready to mint with.{" "}
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
          Load more
        </button>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="rounded-3xl border border-gray-200 bg-white p-6">
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {dispensers.length > 0
            ? "Every route has a purchase pending in the mempool — check back in a few minutes."
            : "No open XCP dispensers right now — check the DEX or try again later."}
        </p>
      </div>
    );
  }

  const buttonLabel = busy
    ? compose.status === "composing"
      ? "Composing…"
      : compose.status === "signing"
        ? "Confirm in wallet…"
        : "Broadcasting…"
    : n === 0
      ? "Enter an amount"
      : `Load ${commas(snapped)} XCP`;

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* You send · Bitcoin */}
      <div className="rounded-2xl bg-gray-50 p-4">
        <div className="flex h-5 items-center justify-between text-xs text-gray-500">
          <span>You send · Bitcoin</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div
            className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
              btc > 0 ? "text-gray-900" : "text-gray-300"
            }`}
          >
            {btc > 0 ? btc.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : "0"}
          </div>
          {btcChip}
        </div>
        <div className="mt-1 h-4 text-xs text-gray-400">
          {btcUsd && btc > 0 && `≈ ${usdFmt(btc * btcUsd)}`}
        </div>
      </div>

      <FlipNotch onFlip={onFlip} flips={flips} />

      {/* You receive · Counterparty */}
      <div className="group rounded-2xl border border-transparent bg-gray-50 p-4 transition-colors focus-within:border-gray-200 focus-within:bg-white">
        <div className="flex h-5 items-center justify-between text-xs text-gray-500">
          <span>You receive · Counterparty</span>
          {xcpBalance !== undefined && (
            <span>Balance: {commas(xcpBalance / SATS)}</span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <AmountInput
            value={amount}
            onChange={setAmount}
            ariaLabel="XCP to receive"
            className="w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight text-gray-900 outline-none placeholder:text-gray-300"
          />
          {xcpChip}
        </div>
        <div className="mt-1 flex h-4 items-center justify-between text-xs text-gray-400">
          <span>
            {xcpUsd && snapped > 0 && `≈ ${usdFmt(snapped * xcpUsd)}`}
            {typed > 0 && Math.abs(snapped - typed) > 1e-9 && (
              <span className="text-amber-600">
                {" "}
                · snaps to {commas(snapped)} ({commas(unitXcp)}-XCP units)
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={!p.available}
                title={
                  p.available ? undefined : "This route doesn't have that much left"
                }
                onClick={() => setAmount(String(p.k * unitXcp))}
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  !p.available
                    ? "cursor-not-allowed border-gray-100 text-gray-300"
                    : n === p.k && typed > 0
                      ? "border-purple-400 bg-white text-purple-600"
                      : "border-gray-200 bg-white text-gray-500 hover:border-purple-400 hover:text-purple-600"
                }`}
              >
                {p.label}
              </button>
            ))}
          </span>
        </div>
      </div>

      {/* Rate + route details */}
      <div className="px-2 pt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">
            1 XCP = {Math.round(d.price).toLocaleString()} sats
            {perXcpUsd && <span className="text-gray-400"> ({usdFmt(perXcpUsd)})</span>}
            {vsMarket !== null && Math.abs(vsMarket) >= 1 && (
              <span
                className={`font-medium ${vsMarket <= 0 ? "text-green-600" : "text-amber-600"}`}
              >
                {" "}
                · {Math.abs(vsMarket).toFixed(0)}%{" "}
                {vsMarket <= 0 ? "below" : "above"} market
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-label="Route details"
            className="flex items-center gap-1 text-gray-400 hover:text-gray-600"
          >
            <span
              aria-hidden
              className="inline-block transition-transform duration-100"
              style={{ transform: detailsOpen ? "rotate(180deg)" : "none" }}
            >
              ▾
            </span>
          </button>
        </div>
        {detailsOpen && (
          <dl className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <dt>Route</dt>
              <dd>
                <button
                  type="button"
                  onClick={() => setRouteOpen(true)}
                  className="font-medium text-purple-600 hover:underline"
                >
                  {shortAddress(d.source)} · cheapest of {open.length} ▾
                </button>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Route depth</dt>
              <dd>{commas(d.give_remaining / SATS)} XCP left</dd>
            </div>
            <div className="flex justify-between">
              <dt>Arrival</dt>
              <dd>next block after your BTC confirms</dd>
            </div>
            {snapped > 0 && (
              <div className="flex justify-between">
                <dt>Mints</dt>
                <dd>{compact(snapped * TOKENS_PER_XCP)} tokens of any launch</dd>
              </div>
            )}
            {hiddenCount > 0 && (
              <div className="flex justify-between">
                <dt>Hidden routes</dt>
                <dd>{hiddenCount} with a purchase pending in the mempool</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="px-0.5 pb-0.5 pt-3">
        {(compose.status === "error" || preflightError) && (
          <p className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {preflightError ?? compose.error}
          </p>
        )}

        {walletStatus !== "connected" ? (
          <button
            type="button"
            onClick={() => connect()}
            className="w-full rounded-2xl bg-gray-900 px-5 py-3.5 font-medium text-white transition-all hover:bg-gray-700 active:scale-[0.99]"
          >
            {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || n === 0}
            onClick={async () => {
              // Re-check the route at the moment of purchase: a dispense
              // onto a drained or closed dispenser forfeits the BTC.
              setPreflightError(null);
              try {
                const res = await fetch(
                  `${COUNTERPARTY_API_BASE}/addresses/${d.source}/dispensers`,
                  { signal: AbortSignal.timeout(10_000) },
                );
                const rows: {
                  asset: string;
                  status: number;
                  give_remaining: number;
                  satoshirate: number;
                }[] = res.ok ? ((await res.json()).result ?? []) : [];
                const live = rows.find((r) => r.asset === "XCP");
                if (!live || live.status !== 0) {
                  setPreflightError(
                    "This route just closed — pick another from the details.",
                  );
                  return;
                }
                if (live.satoshirate !== d.satoshirate) {
                  setPreflightError(
                    "This route's price just changed — refresh the page.",
                  );
                  return;
                }
                if (live.give_remaining < n * d.give_quantity) {
                  setPreflightError(
                    `Only ${commas(live.give_remaining / SATS)} XCP left on this route — lower the amount.`,
                  );
                  return;
                }
              } catch {
                // Can't verify — compose-time validation still applies.
              }
              compose.composeDispense({ dispenser: d.source, quantity: btcSats });
            }}
            className="w-full rounded-2xl bg-purple-600 px-5 py-3.5 font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {buttonLabel}
          </button>
        )}
        <p className="mt-2 px-1.5 text-center text-[11px] text-gray-400">
          Non-custodial: the protocol vends automatically when your BTC
          confirms. A dispense is a purchase — no refund path.
        </p>
      </div>

      {routeOpen && (
        <div
          className="backdrop-fade fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
          onClick={() => setRouteOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Choose a route"
        >
          <div
            className="modal-pop w-full max-w-sm rounded-3xl bg-white p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="text-sm font-semibold text-gray-900">
                Choose a route
              </span>
              <button
                type="button"
                onClick={() => setRouteOpen(false)}
                aria-label="Close"
                className="flex size-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[45vh] overflow-y-auto">
              {open.map((disp, i) => (
                <button
                  key={disp.source}
                  type="button"
                  onClick={() => {
                    setRouteIdx(i);
                    setRouteOpen(false);
                  }}
                  className={`flex h-14 w-full items-center justify-between gap-3 rounded-xl px-3 text-left transition-colors hover:bg-gray-50 ${
                    disp.source === d.source ? "bg-purple-50/60" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">
                      {Math.round(disp.price).toLocaleString()} sats/XCP
                      {btcUsd && (
                        <span className="font-normal text-gray-400">
                          {" "}
                          ({usdFmt((disp.price / SATS) * btcUsd)})
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-gray-400">
                      {shortAddress(disp.source)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {commas(disp.give_remaining / SATS)} XCP left
                  </span>
                </button>
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="px-3 pb-1 pt-2 text-[11px] text-gray-400">
                {hiddenCount} route{hiddenCount === 1 ? "" : "s"} hidden — a
                purchase is pending in the mempool.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unload: XCP → BTC by posting a dispenser at your price              */
/* ------------------------------------------------------------------ */

interface OwnDispenser {
  give_remaining: number;
  satoshirate: number;
  give_quantity: number;
  status: number;
  close_block_index: number | null;
}

function UnloadCard({
  btcUsd,
  xcpUsd,
  onFlip,
  flips,
}: {
  btcUsd: number | null;
  xcpUsd: number | null;
  onFlip: () => void;
  flips: number;
}) {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();

  const marketSats = btcUsd && xcpUsd ? Math.round((xcpUsd / btcUsd) * SATS) : null;
  const [escrow, setEscrow] = useState("");
  const [price, setPrice] = useState(""); // sats per XCP

  const { data: balance } = useSWR(
    address ? [address, "XCP", "unload-balance"] : null,
    ([addr]) => fetchBalance(addr, "XCP"),
    { refreshInterval: 30_000 },
  );

  // No status filter: a CLOSING dispenser (status 11) still vends for ~5
  // blocks and blocks any new open on the address.
  const { data: existing, mutate: refreshExisting } = useSWR<OwnDispenser | null>(
    address ? [address, "own-dispenser"] : null,
    async ([addr]) => {
      const data = await fetchJson(
        `${COUNTERPARTY_API_BASE}/addresses/${addr}/dispensers`,
      );
      const rows: (OwnDispenser & { asset: string })[] = data.result ?? [];
      return (
        rows.find((disp) => disp.asset === "XCP" && [0, 1, 11].includes(disp.status)) ??
        null
      );
    },
    { refreshInterval: 30_000 },
  );

  const priceSats = Math.round(parseFloat(price)) || (marketSats ?? 0);
  const escrowRaw = Math.round((parseFloat(escrow) || 0) * SATS);
  const btcIfSold = priceSats > 0 ? (escrowRaw / SATS) * (priceSats / SATS) : 0;
  const perXcpUsd = btcUsd ? (priceSats / SATS) * btcUsd : null;
  const vsMarket = perXcpUsd && xcpUsd ? (perXcpUsd / xcpUsd - 1) * 100 : null;
  const insufficient =
    balance !== undefined && escrowRaw > 0 && escrowRaw > balance;

  const busy =
    compose.status === "composing" ||
    compose.status === "signing" ||
    compose.status === "broadcasting";
  const ready = escrowRaw >= SATS && priceSats > 0 && !busy && !existing && !insufficient;

  const openDispenser = () =>
    compose.composeDispenser({
      asset: "XCP",
      give_quantity: SATS, // 1 XCP per vend — matches the load list's filter
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
      <div className="rounded-3xl border border-green-200 bg-green-50 p-5 text-sm">
        <div className="font-semibold text-green-800">Broadcast</div>
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

  if (existing?.status === 11) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-white p-6 text-sm text-gray-700">
        <p className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-amber-500" />
          <span className="font-semibold">Unload closing</span>
        </p>
        <p className="mt-2">
          It can still sell until{" "}
          {existing.close_block_index
            ? `block ${existing.close_block_index.toLocaleString()}`
            : "the close settles (~5 blocks)"}
          , then the remaining{" "}
          <span className="font-semibold">
            {commas(existing.give_remaining / SATS)} XCP
          </span>{" "}
          returns automatically.
        </p>
      </div>
    );
  }

  if (existing) {
    return (
      <div className="rounded-3xl border border-gray-200 bg-white p-6 text-sm text-gray-700">
        <p>
          <span className="font-semibold">Currently unloading:</span>{" "}
          {commas(existing.give_remaining / SATS)} XCP left at{" "}
          {Math.round(
            (existing.satoshirate / existing.give_quantity) * SATS,
          ).toLocaleString()}{" "}
          sats/XCP. BTC lands with every sale. Closing settles ~5 blocks after
          it confirms and returns the rest.
        </p>
        {compose.status === "error" && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {compose.error}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={close}
          className="mt-3 w-full rounded-2xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition-all hover:border-red-400 hover:text-red-600 active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "Working…" : "Stop unloading & reclaim"}
        </button>
      </div>
    );
  }

  const buttonLabel = busy
    ? compose.status === "signing"
      ? "Confirm in wallet…"
      : "Working…"
    : escrowRaw === 0
      ? "Enter an amount"
      : insufficient
        ? "Insufficient XCP balance"
        : escrowRaw < SATS
          ? "Minimum 1 XCP"
          : `Unload ${commas(escrowRaw / SATS)} XCP`;

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* You send · Counterparty */}
      <div className="group rounded-2xl border border-transparent bg-gray-50 p-4 transition-colors focus-within:border-gray-200 focus-within:bg-white">
        <div className="flex h-5 items-center justify-between text-xs text-gray-500">
          <span>You send · Counterparty</span>
          {balance !== undefined && (
            <button
              type="button"
              className="hover:text-gray-700 hover:underline"
              onClick={() =>
                setEscrow((balance / SATS).toFixed(8).replace(/\.?0+$/, ""))
              }
            >
              Balance: {commas(balance / SATS)}
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <AmountInput
            value={escrow}
            onChange={setEscrow}
            ariaLabel="XCP to unload"
            className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
              insufficient ? "text-red-600" : "text-gray-900"
            }`}
          />
          {xcpChip}
        </div>
        <div className="mt-1 h-4 text-xs text-gray-400">
          {xcpUsd && escrowRaw > 0 && `≈ ${usdFmt((escrowRaw / SATS) * xcpUsd)}`}
        </div>
      </div>

      <FlipNotch onFlip={onFlip} flips={flips} />

      {/* You receive · Bitcoin */}
      <div className="rounded-2xl bg-gray-50 p-4">
        <div className="flex h-5 items-center justify-between text-xs text-gray-500">
          <span>You receive · Bitcoin</span>
          <span>as it sells, at your price</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div
            className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
              btcIfSold > 0 ? "text-gray-900" : "text-gray-300"
            }`}
          >
            {btcIfSold > 0
              ? `≤ ${btcIfSold.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`
              : "0"}
          </div>
          {btcChip}
        </div>
        <div className="mt-1 h-4 text-xs text-gray-400">
          {btcUsd && btcIfSold > 0 && `≈ ${usdFmt(btcIfSold * btcUsd)} if fully sold`}
        </div>
      </div>

      {/* Price row */}
      <div className="px-2 pt-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-gray-500">Your price</span>
          <span className="flex items-center gap-2">
            <span
              className={`flex items-center rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
                parseFloat(price) > 0 ? "border-purple-300" : "border-gray-200"
              }`}
            >
              <AmountInput
                value={price}
                onChange={setPrice}
                placeholder={marketSats ? String(marketSats) : "0"}
                ariaLabel="Price in sats per XCP"
                className="w-16 bg-transparent text-right text-xs font-medium outline-none"
              />
              <span className="ml-1 text-gray-400">sats/XCP</span>
            </span>
            {vsMarket !== null && (
              <span
                className={
                  Math.abs(vsMarket) < 0.5
                    ? "font-medium text-gray-500"
                    : vsMarket > 0
                      ? "font-medium text-green-600"
                      : "font-medium text-amber-600"
                }
              >
                {Math.abs(vsMarket) < 0.5
                  ? "at market"
                  : vsMarket > 0
                    ? `+${vsMarket.toFixed(0)}% premium`
                    : `−${Math.abs(vsMarket).toFixed(0)}% · sells fast`}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="px-0.5 pb-0.5 pt-3">
        {compose.status === "error" && (
          <p className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {compose.error}
          </p>
        )}

        {walletStatus !== "connected" ? (
          <button
            type="button"
            onClick={() => connect()}
            className="w-full rounded-2xl bg-gray-900 px-5 py-3.5 font-medium text-white transition-all hover:bg-gray-700 active:scale-[0.99]"
          >
            {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={openDispenser}
            className="w-full rounded-2xl bg-purple-600 px-5 py-3.5 font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {buttonLabel}
          </button>
        )}
        <p className="mt-2 px-1.5 text-center text-[11px] text-gray-400">
          Sells 1 XCP at a time from your own on-chain dispenser — no
          counterparty, no custody. Closing takes ~5 blocks and returns the
          rest.
        </p>
      </div>
    </div>
  );
}
