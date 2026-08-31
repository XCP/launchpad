"use client";

import { useState } from "react";
import { commas, compact, price as priceFmt, usd as usdFmt } from "@/lib/format";
import { XCP69, XCP69_MIN_PARTICIPANTS, XCP69_RAISE_SATS } from "@/lib/xcp69";

/**
 * The standard as something you can drag. Two gestures, numbers doing the
 * talking: a supply meter with the all-or-nothing line, and the pool under
 * trade pressure via the protocol's own constant-product math.
 *
 * Color system: XCP is purple (brand), tokens are cyan, amber = short of
 * the line, green = crossed it, red = under mint price. Prose lives in
 * <details>; the visible layer is numbers, bars, and one status line.
 */

const RAISE = XCP69_RAISE_SATS / 1e8; // 690 XCP
const POOL_TOKENS = XCP69.POOL_QUANTITY / 1e8; // 31,000,000
const FLOAT = XCP69.SOFT_CAP / 1e8; // 69,000,000 — the whole mint cohort
const SUPPLY = FLOAT + POOL_TOKENS; // 100,000,000
const MINT_PRICE = XCP69.PRICE / XCP69.QUANTITY_BY_PRICE; // 0.00001 XCP
const OPEN_PRICE = RAISE / POOL_TOKENS; // ≈ 2.23× mint
const FEE = 0.005; // 50 bps XCP-pair pool fee
const MAX_ADDR = XCP69_MIN_PARTICIPANTS; // 69
const XCP_PER_ADDR = 10;
/** counterparty-core lib/ledger/markets.py::compute_pool_output */
function poolOutput(reserveIn: number, reserveOut: number, input: number): number {
  if (input <= 0) return 0;
  const withFee = input * (1 - FEE);
  return (withFee * reserveOut) / (reserveIn + withFee);
}

/**
 * Post-trade marginal price after buying with `xcpIn`. Per core's
 * execute_pool_match, the reserve gains the FULL input (the fee stays in
 * the pool and deepens it); only the output is computed on the fee-reduced
 * amount.
 */
function priceAfterBuy(xcpIn: number): number {
  const tokensOut = poolOutput(RAISE, POOL_TOKENS, xcpIn);
  return (RAISE + xcpIn) / (POOL_TOKENS - tokensOut);
}

/**
 * The right end of the pressure slider lands exactly on 420× mint price —
 * the meme is intentional — solved against the same model the slider runs
 * (bisection; closed forms drift when the fee asymmetry is in play).
 */
const TARGET_MULTIPLE = 420;
const MAX_BUY_XCP = (() => {
  const target = TARGET_MULTIPLE * MINT_PRICE;
  let lo = 0;
  let hi = 100_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (priceAfterBuy(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();

export function StandardPlayground({
  xcpUsd,
  children,
}: {
  xcpUsd: number | null;
  children?: React.ReactNode;
}) {
  // Steps 2 and 3 don't exist until the launch has sold out once — the page
  // structure teaching the mechanism. Latched: crossing the line reveals
  // them for good; dragging back down doesn't unmake the pool.
  const [unlocked, setUnlocked] = useState(false);
  return (
    <div className="space-y-4">
      <LaunchMeter xcpUsd={xcpUsd} onSoldOut={() => setUnlocked(true)} />
      {unlocked ? (
        <>
          <PoolStress xcpUsd={xcpUsd} />
          {children}
        </>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-800 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
          Sell out the launch above — the pool only exists on the other side
          of the line.
        </div>
      )}
    </div>
  );
}

function withUsd(xcp: number, xcpUsd: number | null): string {
  return xcpUsd ? ` (≈${usdFmt(xcp * xcpUsd)})` : "";
}

function LaunchMeter({
  xcpUsd,
  onSoldOut,
}: {
  xcpUsd: number | null;
  onSoldOut: () => void;
}) {
  // Slider travel maps 1:1 onto the supply bar below it: the track spans the
  // full 100M, but the thumb CLAMPS at the 69% finish line — you can feel
  // the edge of what can be minted; the last 31% belongs to the pool.
  const salePct = (FLOAT / SUPPLY) * 100; // the 69% finish line
  const [pos, setPos] = useState(0);
  const soldOut = pos >= salePct;
  const mintedPct = Math.min(pos, salePct);
  const minted = (mintedPct / 100) * SUPPLY;
  const committed = minted * MINT_PRICE; // XCP escrowed so far

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">1 · The launch is binary</h3>
        <div className="text-right">
          <span className={`text-3xl font-bold ${soldOut ? "text-green-600 dark:text-green-400" : "text-gray-900 dark:text-gray-100"}`}>
            {compact(minted)}
          </span>
          <span className="text-sm text-gray-400 dark:text-gray-500"> of {compact(SUPPLY)} supply minted</span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => {
          const next = Math.min(Number(e.target.value), salePct);
          setPos(next);
          if (next >= salePct) onSoldOut();
        }}
        className="ui-slider mt-3 w-full"
        aria-label="Tokens minted"
        aria-valuemax={salePct}
      />

      {/* The whole 100M supply as one bar: the sale fills toward the 69%
          line; the pool's 31% only exists if the line is crossed. */}
      <div className="relative mt-2 h-7 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full transition-all duration-300 ${
            soldOut ? "bg-green-500" : "bg-amber-400"
          }`}
          style={{ width: `${mintedPct}%` }}
        />
        {/* Pool allocation: colorless until the line is crossed — it doesn't
            exist yet — then the token cyan from card 2 (bluer than the green
            sale fill, so the two segments read apart). */}
        <div
          className={`absolute inset-y-0 transition-colors duration-300 ${
            soldOut ? "bg-cyan-500" : "bg-gray-200 dark:bg-gray-700"
          }`}
          style={{ left: `${salePct}%`, right: 0 }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-gray-800 dark:bg-gray-200"
          style={{ left: `${salePct}%` }}
        />
      </div>
      <div className="mt-1 flex text-xs text-gray-400 dark:text-gray-500">
        <span style={{ width: `${salePct}%` }}>public sale · 69M</span>
        <span>pool · 31M</span>
      </div>

      <p className="mt-2 text-sm">
        {soldOut ? (
          <span className="font-medium text-green-700 dark:text-green-400">
            ✓ Graduated — pool created with {commas(RAISE)} XCP
            {withUsd(RAISE, xcpUsd)} + 31M tokens, LP burned.
          </span>
        ) : pos === 0 ? (
          <span className="font-medium text-blue-700 dark:text-blue-300">
            ⏳ Scheduled — announced on-chain, nothing minted yet.
          </span>
        ) : (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            ↩ Minting — {commas(Math.round(committed))} XCP
            {withUsd(committed, xcpUsd)} raised so far, all of it returned
            automatically if the launch doesn&apos;t sell out.
          </span>
        )}
      </p>

      <details className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400">
          how it works
        </summary>
        <p className="mt-2">
          The sale line sits at 69M of the 100M supply; the other 31M is
          reserved for the pool and only ever exists if the line is crossed —
          69 + 31 = 100, locked, nowhere else for supply to be. Below the
          line, every escrowed satoshi refunds at the deadline: there is no
          partial launch to be bag-held. The {XCP_PER_ADDR} XCP per-address
          cap means crossing takes at least {MAX_ADDR} distinct addresses —
          more if people mint below the cap. A floor on the crowd, not a
          count.
        </p>
      </details>
    </div>
  );
}

function PoolStress({ xcpUsd }: { xcpUsd: number | null }) {
  // t ∈ [-100, 100]; quadratic magnitude keeps small trades readable while
  // the extremes still fit on the same track.
  const [t, setT] = useState(0);
  const mag = (t / 100) ** 2;

  let price = OPEN_PRICE;
  let xcpReserve = RAISE;
  let tokenReserve = POOL_TOKENS;
  let line: string | null = null;

  if (t < 0) {
    const tokensIn = mag * FLOAT;
    const xcpOut = poolOutput(POOL_TOKENS, RAISE, tokensIn);
    // Full input joins the reserve — the fee stays in the pool (core's
    // execute_pool_match adds give_quantity whole).
    tokenReserve = POOL_TOKENS + tokensIn;
    xcpReserve = RAISE - xcpOut;
    price = xcpReserve / tokenReserve;
    // Sellers' average exit price vs what they minted at. The pool opens at
    // 2.23× mint, so small dumps exit ABOVE mint cost — that's the opening
    // premium doing its job, and the copy should say so.
    const exitMultiple = tokensIn > 0 ? xcpOut / tokensIn / MINT_PRICE : 0;
    line =
      t === -100
        ? `Every minted token dumped in one trade — the pool still quotes a bid with ${commas(Math.round(xcpReserve))} XCP left, and sellers exit at ${exitMultiple.toFixed(2)}× mint (${(exitMultiple * 100).toFixed(0)}% of what they paid). Those ${commas(Math.round(xcpReserve))} XCP can never be withdrawn: every launch is a permanent sink for XCP itself.`
        : `${(mag * 100).toFixed(mag < 0.1 ? 1 : 0)}% of the float dumped → sellers get ${commas(Math.round(xcpOut))} XCP back, exiting at ${exitMultiple.toFixed(2)}× their mint price${
            exitMultiple >= 1 ? " — the opening premium absorbing the exit" : " — below mint cost now"
          }.`;
  } else if (t > 0) {
    const xcpIn = mag * MAX_BUY_XCP;
    const tokensOut = poolOutput(RAISE, POOL_TOKENS, xcpIn);
    xcpReserve = RAISE + xcpIn;
    tokenReserve = POOL_TOKENS - tokensOut;
    price = xcpReserve / tokenReserve;
    line =
      t === 100
        ? `It took ${commas(Math.round(xcpIn))} XCP${withUsd(xcpIn, xcpUsd)} of buying — and every satoshi of it is locked liquidity now, backing the new price.`
        : `${commas(Math.round(xcpIn))} XCP${withUsd(xcpIn, xcpUsd)} of net buying — and all of it joins the locked reserve.`;
  }

  const multiple = price / MINT_PRICE;
  const multipleColor =
    multiple >= OPEN_PRICE / MINT_PRICE - 0.005
      ? "text-green-600 dark:text-green-400"
      : multiple >= 1
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  // Piecewise scale anchored at the opening tick (dead center): reserves
  // below opening map 0→50%, above opening 50→100% of that direction's
  // maximum. Bars open EQUAL (both sides hold equal value by construction)
  // and peg full at the extremes — a scale tipping.
  const XCP_MAX = RAISE + MAX_BUY_XCP;
  const TOKEN_MAX = POOL_TOKENS + FLOAT;
  const barPct = (reserve: number, opening: number, max: number): number =>
    reserve <= opening
      ? (reserve / opening) * 50
      : 50 + ((reserve - opening) / (max - opening)) * 50;
  const xcpPct = barPct(xcpReserve, RAISE, XCP_MAX);
  const tokenPct = barPct(tokenReserve, POOL_TOKENS, TOKEN_MAX);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">2 · The liquidity is locked</h3>
        <div className="text-right">
          <span className={`text-3xl font-bold ${multipleColor}`}>
            {multiple >= 99.5 ? Math.round(multiple) : multiple.toFixed(2)}×
          </span>
          <span className="text-sm text-gray-400 dark:text-gray-500"> mint price</span>
        </div>
      </div>

      <div className="mt-2 flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>everyone dumps</span>
        <span>open</span>
        <span>whale buys</span>
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        value={t}
        onChange={(e) => setT(Number(e.target.value))}
        className="ui-slider w-full"
        aria-label="Trade pressure through the pool"
      />

      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300">XCP in the pool</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {commas(Math.round(xcpReserve))}
              <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                {withUsd(xcpReserve, xcpUsd)}
              </span>
            </span>
          </div>
          <div className="relative mt-1 h-5 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full bg-purple-600 transition-all duration-300"
              style={{ width: `${xcpPct}%` }}
            />
            <div className="absolute inset-y-0 left-1/2 w-px bg-gray-400 dark:bg-gray-500" />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-cyan-700 dark:text-cyan-300">Tokens in the pool</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{compact(tokenReserve)}</span>
          </div>
          <div className="relative mt-1 h-5 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full bg-cyan-500 transition-all duration-300"
              style={{ width: `${tokenPct}%` }}
            />
            <div className="absolute inset-y-0 left-1/2 w-px bg-gray-400 dark:bg-gray-500" />
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-md bg-gray-50 dark:bg-gray-800/60 p-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">Token price</div>
          <div className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {priceFmt(price)} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">XCP</span>
          </div>
          {xcpUsd && (
            <div className="text-xs text-gray-400 dark:text-gray-500">≈{usdFmt(price * xcpUsd)}</div>
          )}
        </div>
        <div className="rounded-md bg-gray-50 dark:bg-gray-800/60 p-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">Market cap</div>
          <div className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {compact(price * SUPPLY)}{" "}
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">XCP</span>
          </div>
          {xcpUsd && (
            <div className="text-xs text-gray-400 dark:text-gray-500">
              ≈{usdFmt(price * SUPPLY * xcpUsd)}
            </div>
          )}
        </div>
      </div>

      {line && <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">{line}</p>}

      <details className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400">
          how it works
        </summary>
        <p className="mt-2">
          This is the protocol&apos;s own swap math: constant product with a
          50 bps fee that stays in the pool. Price is the ratio of the two
          reserves — one drains as the other fills, which is why the tick
          marks sit at center: both sides open worth {commas(RAISE)} XCP
          each. The reserve approaches zero without ever arriving, and the
          LP is burned, so this liquidity can be traded against forever and
          withdrawn by no one — whatever XCP sits in the pool is out of
          circulation for good.
        </p>
        <p className="mt-2">
          Two honesty notes. The slider is a bounding envelope — pure
          one-way flow, all sellers or all buyers, nothing interleaved. Real
          markets mix both directions, and every round trip leaves 50 bps
          behind in the pool, so the real path lives strictly inside these
          extremes. And market cap = price × circulating supply — issued
          supply minus burned tokens. It is a convention, not
          a promise.
        </p>
      </details>
    </div>
  );
}
