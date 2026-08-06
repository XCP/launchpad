"use client";

import { useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { BtcChip, XcpChip } from "@/components/asset-chip";
import { ErrorBanner } from "@/components/ui/error-banner";
import { FlipNotch } from "@/components/ui/flip-notch";
import { Well } from "@/components/ui/well";
import { ConfirmCard, TxLink } from "@/components/ui/confirm-card";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import type { Dispenser } from "@/lib/api/counterparty";
import { commas, compact, shortAddress, usd as usdFmt } from "@/lib/format";
import { isBusy } from "@/lib/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { XCP69 } from "@/lib/xcp69";
import { fetchBalance, fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import {
  MAX_LEGS,
  useDispenseRouter,
  type PlannedLeg,
} from "./use-dispense-router";

const SATS = 1e8;
/** 1 XCP mints 100,000 tokens of any launch (lot size ÷ lot price). */
const TOKENS_PER_XCP = XCP69.QUANTITY_BY_PRICE / XCP69.PRICE;

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

  return (
    <div>
      <Tabs
        value={direction}
        onValueChange={(v) => {
          if (v !== direction) flip();
        }}
      >
        <SegmentedList className="mb-4 w-64">
          <SegmentedTrigger value="load">Buy XCP</SegmentedTrigger>
          <SegmentedTrigger value="unload">Sell XCP</SegmentedTrigger>
        </SegmentedList>
      </Tabs>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
        {direction === "load" ? (
          <LoadCard
            dispensers={dispensers}
            btcUsd={btcUsd}
            xcpUsd={xcpUsd}
            onFlip={flip}
            flips={flips}
          />
        ) : (
          <UnloadCard
            dispensers={dispensers}
            btcUsd={btcUsd}
            xcpUsd={xcpUsd}
            onFlip={flip}
            flips={flips}
          />
        )}
      </div>
    </div>
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
  const router = useDispenseRouter();
  const [routeIdx, setRouteIdx] = useState(0);
  // Independent-field pattern: whichever side was typed last drives; the
  // other derives. No dead fields — start from either end of the bridge.
  const [xcpAmount, setXcpAmount] = useState("");
  const [btcAmount, setBtcAmount] = useState("");
  const [lastEdited, setLastEdited] = useState<"xcp" | "btc">("xcp");
  const [routeOpen, setRouteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [armed, setArmed] = useState(false);

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

  // Miner fees are part of the price: every leg is its own transaction, so
  // the planner weighs a cheap-but-shallow route against the extra ~LEG_VBYTES
  // fee another transaction costs.
  const { data: feeRec } = useSWR<{ halfHourFee: number }>(
    "https://mempool.space/api/v1/fees/recommended",
    (url: string) => fetchJson(url),
    { refreshInterval: 60_000 },
  );
  const legFeeSats = Math.max(1, feeRec?.halfHourFee ?? 3) * 300;

  const pick = Math.min(routeIdx, Math.max(open.length - 1, 0));
  const d = open[pick];
  const forced = pick !== 0 && d ? d : null; // user explicitly chose a route
  const unitXcp = d ? d.give_quantity / SATS : 1;
  const capsAll = open.map((r) =>
    Math.max(0, Math.floor(r.give_remaining / r.give_quantity)),
  );
  // Max fillable = the MAX_LEGS deepest routes combined.
  const capacity = [...capsAll]
    .sort((a, b) => b - a)
    .slice(0, MAX_LEGS)
    .reduce((s, c) => s + c, 0);
  const typedXcp = parseFloat(xcpAmount) || 0;
  const typedBtcSats = Math.round((parseFloat(btcAmount) || 0) * SATS);
  // BTC side floors against cheapest-first fill, as the protocol prices a
  // payment (get_must_give floors — overpay is kept). Approximate inverse;
  // the plan below recomputes exactly from the unit count.
  const unitsForSats = (sats: number) => {
    let left = sats;
    let units = 0;
    for (let i = 0; i < open.length && i < MAX_LEGS; i++) {
      const take = Math.min(capsAll[i], Math.floor(left / open[i].satoshirate));
      units += take;
      left -= take * open[i].satoshirate;
    }
    return Math.min(units, capacity);
  };
  const n = d
    ? lastEdited === "xcp"
      ? Math.max(0, Math.min(capacity, Math.round(typedXcp / unitXcp)))
      : Math.max(0, unitsForSats(typedBtcSats))
    : 0;
  // Fee-aware split: enumerate every route subset (≤ MAX_LEGS legs, first 8
  // routes), fill cheapest-first within the subset, minimize
  // XCP-cost + legs × legFee. Skipping a shallow bargain route to save a
  // whole transaction falls out naturally.
  const plan: PlannedLeg[] = (() => {
    if (n === 0 || open.length === 0) return [];
    const routes = open.slice(0, 8);
    const caps = routes.map((r) =>
      Math.max(0, Math.floor(r.give_remaining / r.give_quantity)),
    );
    const subsets: number[][] = [];
    for (let a = 0; a < routes.length; a++) {
      subsets.push([a]);
      for (let b = a + 1; b < routes.length; b++) {
        subsets.push([a, b]);
        for (let c = b + 1; c < routes.length; c++) subsets.push([a, b, c]);
      }
    }
    let best: PlannedLeg[] = [];
    let bestCost = Infinity;
    for (const sub of subsets) {
      if (forced && !sub.some((i) => routes[i].source === forced.source)) continue;
      if (sub.reduce((s, i) => s + caps[i], 0) < n) continue;
      const order = [...sub].sort(
        (x, y) => routes[x].satoshirate - routes[y].satoshirate,
      );
      let left = n;
      const legs: PlannedLeg[] = [];
      for (const i of order) {
        const take = Math.min(caps[i], left);
        if (take > 0)
          legs.push({
            dispenser: routes[i],
            units: take,
            btcSats: take * routes[i].satoshirate,
          });
        left -= take;
      }
      if (left > 0) continue;
      const cost = legs.reduce((s, l) => s + l.btcSats, 0) + legs.length * legFeeSats;
      if (cost < bestCost || (cost === bestCost && legs.length < best.length)) {
        best = legs;
        bestCost = cost;
      }
    }
    return best;
  })();
  const snapped = n * unitXcp;
  const btcSats = plan.reduce((s, l) => s + l.btcSats, 0);
  const btc = btcSats / SATS;
  const blendedSatsPerXcp = snapped > 0 ? btcSats / snapped : d ? d.price : 0;
  const fmtBtc = (sats: number) =>
    (sats / SATS).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

  const presets = d
    ? [1, 5, 10, 100].map((target) => {
        const k = Math.max(1, Math.round((target * SATS) / d.give_quantity));
        return { label: `${target}`, k, available: k <= capacity };
      })
    : [];

  const perXcpUsd = d && btcUsd ? (blendedSatsPerXcp / SATS) * btcUsd : null;
  const vsMarket = perXcpUsd && xcpUsd ? (perXcpUsd / xcpUsd - 1) * 100 : null;

  const busy = router.phase === "running";

  if (router.phase !== "idle") {
    const doneXcp = router.legs
      .filter((l) => l.status === "done")
      .reduce((s, l) => s + l.units * (l.dispenser.give_quantity / SATS), 0);
    const totalXcp = router.legs.reduce(
      (s, l) => s + l.units * (l.dispenser.give_quantity / SATS),
      0,
    );
    const allDone = router.phase === "done";
    return (
      <div className="rounded-3xl border border-gray-200 bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">
          {allDone
            ? `${commas(totalXcp)} XCP incoming`
            : `Loading ${commas(totalXcp)} XCP · ${router.legs.length} route${
                router.legs.length === 1 ? "" : "s"
              }`}
        </div>
        <ul className="mt-3 space-y-2">
          {router.legs.map((leg, i) => (
            <li
              key={`${leg.dispenser.source}-${i}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-gray-900">
                  {commas(leg.units * (leg.dispenser.give_quantity / SATS))} XCP
                </span>
                <span className="text-gray-400">
                  {" "}
                  · {shortAddress(leg.dispenser.source)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {leg.status === "done" && leg.txid ? (
                  <a
                    href={`https://xcp.io/tx/${leg.txid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-green-700 underline"
                  >
                    ✓ broadcast
                  </a>
                ) : leg.status === "error" ? (
                  <>
                    <span
                      className="max-w-40 truncate text-red-600"
                      title={leg.error ?? undefined}
                    >
                      {leg.error}
                    </span>
                    <button
                      type="button"
                      onClick={() => router.retry(i)}
                      className="rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:border-purple-400 hover:text-purple-600"
                    >
                      Retry
                    </button>
                  </>
                ) : leg.status === "pending" ? (
                  <span className="text-gray-400">waiting</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-purple-600">
                    <span className="size-1.5 animate-pulse rounded-full bg-purple-500" />
                    {leg.status === "signing"
                      ? `confirm in wallet (${i + 1} of ${router.legs.length})`
                      : `${leg.status}…`}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {router.planError && (
          <ErrorBanner className="mt-2">{router.planError}</ErrorBanner>
        )}
        {allDone ? (
          <>
            <p className="mt-3 text-xs text-gray-500">
              {commas(doneXcp)} XCP lands on your Counterparty balance as each
              payment confirms — ready to mint with.
            </p>
            <button
              type="button"
              onClick={() => {
                router.reset();
                setXcpAmount("");
                setBtcAmount("");
              }}
              className="mt-2 text-sm font-medium text-purple-700 underline"
            >
              Load more
            </button>
          </>
        ) : busy ? (
          <p className="mt-3 text-xs text-gray-400">
            One wallet confirmation per route — keep this tab open.
          </p>
        ) : (
          <p className="mt-3 text-xs text-gray-500">
            Broadcast legs are final — each is its own transaction. Failed
            legs can be retried.
          </p>
        )}
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

  const buttonLabel =
    n === 0
      ? "Enter an amount"
      : armed && plan.length > 1
        ? `Sign ${plan.length} transactions`
        : `Load ${commas(snapped)} XCP${plan.length > 1 ? ` · ${plan.length} routes` : ""}`;

  return (
    <div className="contents">
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* You receive · Counterparty — XCP always first */}
      <Well
        focusable
        label="You receive · Counterparty"
        topRight={
          xcpBalance !== undefined && (
            <span>Balance: {commas(xcpBalance / SATS)}</span>
          )
        }
        chip={<XcpChip />}
        footer={
          <>
            <span>
              {xcpUsd && snapped > 0 && `≈ ${usdFmt(snapped * xcpUsd)}`}
              {lastEdited === "xcp" &&
                typedXcp > 0 &&
                Math.abs(snapped - typedXcp) > 1e-9 && (
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
                  onClick={() => {
                    setXcpAmount(String(p.k * unitXcp));
                    setLastEdited("xcp");
                    setArmed(false);
                  }}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    !p.available
                      ? "cursor-not-allowed border-gray-100 text-gray-300"
                      : n === p.k && (typedXcp > 0 || typedBtcSats > 0)
                        ? "border-purple-400 bg-white text-purple-600"
                        : "border-gray-200 bg-white text-gray-500 hover:border-purple-400 hover:text-purple-600"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </>
        }
      >
        <AmountInput
          value={
            lastEdited === "xcp" ? xcpAmount : snapped > 0 ? String(snapped) : ""
          }
          onChange={(v) => {
            setXcpAmount(v);
            setLastEdited("xcp");
            setArmed(false);
          }}
          ariaLabel="XCP to receive"
          className="w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight text-gray-900 outline-none placeholder:text-gray-300"
        />
      </Well>

      <FlipNotch onFlip={onFlip} flips={flips} />

      {/* You send · Bitcoin */}
      <Well
        focusable
        label="You send · Bitcoin"
        chip={<BtcChip />}
        footer={
          <span>
            {btcUsd && btc > 0 && `≈ ${usdFmt(btc * btcUsd)}`}
            {lastEdited === "btc" &&
              typedBtcSats > 0 &&
              typedBtcSats !== btcSats && (
                <span className="text-amber-600"> · sends exactly {fmtBtc(btcSats)}</span>
              )}
          </span>
        }
      >
        <AmountInput
          value={lastEdited === "btc" ? btcAmount : btc > 0 ? fmtBtc(btcSats) : ""}
          onChange={(v) => {
            setBtcAmount(v);
            setLastEdited("btc");
            setArmed(false);
          }}
          ariaLabel="BTC to send"
          className="w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight text-gray-900 outline-none placeholder:text-gray-300"
        />
      </Well>

      {/* Rate + route details */}
      <div className="px-2 pt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">
            1 XCP = {Math.round(blendedSatsPerXcp).toLocaleString()} sats
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
            {plan.length > 1 ? (
              plan.map((leg, i) => (
                <div key={leg.dispenser.source} className="flex justify-between">
                  <dt>{i === 0 ? `Routes (${plan.length} txs)` : ""}</dt>
                  <dd>
                    {commas(leg.units * (leg.dispenser.give_quantity / SATS))} XCP
                    · {Math.round(leg.dispenser.price).toLocaleString()} sats ·{" "}
                    {shortAddress(leg.dispenser.source)}
                  </dd>
                </div>
              ))
            ) : (
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
            )}
            <div className="flex justify-between">
              <dt>Depth</dt>
              <dd>
                {commas(capacity * unitXcp)} XCP across up to {MAX_LEGS} of{" "}
                {open.length} route{open.length === 1 ? "" : "s"}
              </dd>
            </div>
            {plan.length > 0 && (
              <div className="flex justify-between">
                <dt title="Each route is its own Bitcoin transaction — the router weighs this against cheaper but shallower routes">
                  Network fees · {plan.length} tx{plan.length === 1 ? "" : "s"}
                </dt>
                <dd>
                  ~{(plan.length * legFeeSats).toLocaleString()} sats
                  {btcUsd
                    ? ` (≈${usdFmt(((plan.length * legFeeSats) / SATS) * btcUsd)})`
                    : ""}
                </dd>
              </div>
            )}
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
        {router.planError && (
          <ErrorBanner className="mb-2">{router.planError}</ErrorBanner>
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
          <>
            {armed && plan.length > 1 && (
              <div className="mb-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2.5 text-xs text-purple-900">
                <div className="font-semibold">
                  {plan.length} routes → {plan.length} wallet signatures
                </div>
                <ul className="mt-1 space-y-0.5">
                  {plan.map((leg, i) => (
                    <li key={leg.dispenser.source}>
                      {i + 1}. {commas(leg.units * (leg.dispenser.give_quantity / SATS))}{" "}
                      XCP · {fmtBtc(leg.btcSats)} BTC →{" "}
                      {shortAddress(leg.dispenser.source)}
                    </li>
                  ))}
                </ul>
                <div className="mt-1 text-purple-700">
                  Your wallet will ask once per route, in order — each popup is
                  one route, nothing more.
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={busy || n === 0}
              onClick={() => {
                if (plan.length > 1 && !armed) {
                  setArmed(true);
                  return;
                }
                setArmed(false);
                router.start(plan);
              }}
              className="w-full rounded-2xl bg-purple-600 px-5 py-3.5 font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {buttonLabel}
            </button>
          </>
        )}
        <p className="mt-2 px-1.5 text-center text-[11px] text-gray-400">
          Non-custodial: the protocol vends automatically when your BTC
          confirms. A dispense is a purchase — no refund path.
        </p>
      </div>

      <Dialog
        open={routeOpen}
        onOpenChange={(o) => !o && setRouteOpen(false)}
        title="Choose a route"
      >
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
      </Dialog>
    </div>
    <RouteBook open={open} plan={plan} hiddenCount={hiddenCount} />
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

  const busy = isBusy(compose.status);
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
      <ConfirmCard
        title="Broadcast"
        onReset={() => {
          compose.reset();
          refreshExisting();
        }}
        resetLabel="Done"
      >
        <p className="mt-1 text-green-700">
          Takes effect when it confirms. <TxLink txid={compose.txid} />
        </p>
      </ConfirmCard>
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
          <ErrorBanner className="mt-3">{compose.error}</ErrorBanner>
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
    <div className="contents">
    <div className="rounded-3xl border border-gray-200 bg-white p-2">
      {/* You send · Counterparty */}
      <Well
        focusable
        label="You send · Counterparty"
        topRight={
          balance !== undefined && (
            <button
              type="button"
              className="hover:text-gray-700 hover:underline"
              onClick={() =>
                setEscrow((balance / SATS).toFixed(8).replace(/\.?0+$/, ""))
              }
            >
              Balance: {commas(balance / SATS)}
            </button>
          )
        }
        chip={<XcpChip />}
        footer={
          <span>
            {xcpUsd && escrowRaw > 0 && `≈ ${usdFmt((escrowRaw / SATS) * xcpUsd)}`}
          </span>
        }
      >
        <AmountInput
          value={escrow}
          onChange={setEscrow}
          ariaLabel="XCP to unload"
          className={`w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight outline-none placeholder:text-gray-300 ${
            insufficient ? "text-red-600" : "text-gray-900"
          }`}
        />
      </Well>

      <FlipNotch onFlip={onFlip} flips={flips} />

      {/* You receive · Bitcoin */}
      <Well
        label="You receive · Bitcoin"
        topRight={<span>as it sells, at your price</span>}
        chip={<BtcChip />}
        footer={
          <span>
            {btcUsd && btcIfSold > 0 && `≈ ${usdFmt(btcIfSold * btcUsd)} if fully sold`}
          </span>
        }
      >
        <div
          className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
            btcIfSold > 0 ? "text-gray-900" : "text-gray-300"
          }`}
        >
          {btcIfSold > 0
            ? `≤ ${btcIfSold.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`
            : "0"}
        </div>
      </Well>

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
          <ErrorBanner className="mb-2">{compose.error}</ErrorBanner>
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
    <SellBook
      open={dispensers}
      yourPriceSats={priceSats}
      active={escrowRaw > 0 || (parseFloat(price) || 0) > 0}
      onPick={(sats) => setPrice(String(sats))}
    />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The route book: the dispenser ladder, cheapest first                */
/* ------------------------------------------------------------------ */

function RouteBook({
  open,
  plan,
  hiddenCount,
}: {
  open: Dispenser[];
  plan: PlannedLeg[];
  hiddenCount: number;
}) {
  const rows = open.slice(0, 10);
  const maxDepth = Math.max(1, ...rows.map((r) => r.give_remaining));
  const taken = new Map(plan.map((l) => [l.dispenser.source, l.units]));
  return (
    <aside className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="px-1 pb-2 text-xs font-medium text-gray-500">
        Dispensers · cheapest first
      </div>
      <ul className="space-y-1">
        {rows.map((r) => {
          const t = taken.get(r.source);
          return (
            <li
              key={r.source}
              title={r.source}
              className={`relative overflow-hidden rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                t ? "border-purple-200 bg-purple-50" : "border-transparent"
              }`}
            >
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 ${
                  t ? "bg-purple-100/70" : "bg-gray-100/80"
                }`}
                style={{
                  width: `${Math.max(6, (r.give_remaining / maxDepth) * 100)}%`,
                }}
              />
              <span className="relative z-10 flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900">
                  {Math.round(r.price).toLocaleString()}{" "}
                  <span className="font-normal text-gray-400">sats</span>
                </span>
                <span className="text-gray-500">
                  {t ? (
                    <span className="font-semibold text-purple-700">
                      {commas(t * (r.give_quantity / SATS))} of{" "}
                    </span>
                  ) : null}
                  {commas(r.give_remaining / SATS)} XCP
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <p className="px-1 pt-2 text-[11px] text-gray-400">
          +{hiddenCount} hidden — purchase pending in mempool
        </p>
      )}
      <p className="px-1 pt-2 text-[11px] leading-relaxed text-gray-400">
        Routing includes miner fees — a deep route can beat a cheaper,
        shallower one.
      </p>
    </aside>
  );
}

/**
 * The same ladder from the seller's side: where your price would rank.
 * The marker only appears once the user is actually selling something,
 * and any competitor's row can be tapped to match its price.
 */
function SellBook({
  open,
  yourPriceSats,
  active,
  onPick,
}: {
  open: Dispenser[];
  yourPriceSats: number;
  active: boolean;
  onPick: (sats: number) => void;
}) {
  const rows = open.slice(0, 10);
  const maxDepth = Math.max(1, ...rows.map((r) => r.give_remaining));
  const rank = yourPriceSats > 0 ? open.filter((r) => r.price < yourPriceSats).length : 0;
  const markerAt = Math.min(rank, rows.length);
  const youRow = active && yourPriceSats > 0 && (
    <li
      key="you"
      className="relative overflow-hidden rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs"
    >
      <span className="relative z-10 flex items-center justify-between gap-2">
        <span className="font-semibold text-amber-800">
          {yourPriceSats.toLocaleString()}{" "}
          <span className="font-normal text-amber-600">sats</span>
        </span>
        <span className="font-medium text-amber-700">
          you · #{rank + 1} of {open.length + 1}
        </span>
      </span>
    </li>
  );
  return (
    <aside className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="px-1 pb-2 text-xs font-medium text-gray-500">
        The competition · cheapest first
      </div>
      <ul className="space-y-1">
        {rows.slice(0, markerAt).map((r) => (
          <SellRow key={r.source} r={r} maxDepth={maxDepth} onPick={onPick} />
        ))}
        {youRow}
        {rows.slice(markerAt).map((r) => (
          <SellRow key={r.source} r={r} maxDepth={maxDepth} onPick={onPick} />
        ))}
      </ul>
      <p className="px-1 pt-2 text-[11px] leading-relaxed text-gray-400">
        Buyers fill cheapest first — the closer to the top, the faster you
        sell. Tap a row to match its price.
      </p>
    </aside>
  );
}

function SellRow({
  r,
  maxDepth,
  onPick,
}: {
  r: Dispenser;
  maxDepth: number;
  onPick: (sats: number) => void;
}) {
  return (
    <li className="relative">
      <button
        type="button"
        title={`${r.source} — click to match this price`}
        onClick={() => onPick(Math.round(r.price))}
        className="relative w-full overflow-hidden rounded-lg border border-transparent px-2.5 py-1.5 text-left text-xs transition-colors hover:border-amber-300 hover:bg-amber-50/50 active:scale-[0.99]"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-gray-100/80"
          style={{ width: `${Math.max(6, (r.give_remaining / maxDepth) * 100)}%` }}
        />
        <span className="relative z-10 flex items-center justify-between gap-2">
          <span className="font-medium text-gray-900">
            {Math.round(r.price).toLocaleString()}{" "}
            <span className="font-normal text-gray-400">sats</span>
          </span>
          <span className="text-gray-500">{commas(r.give_remaining / SATS)} XCP</span>
        </span>
      </button>
    </li>
  );
}
