"use client";

import { useState } from "react";
import type { Fairmint, Pool, PoolSnapshot } from "@/lib/api/counterparty";
import { type Fairminter, XCP69 } from "@/lib/xcp69";
import { LaunchView } from "./launch-view";

type Phase = "scheduled" | "minting" | "graduated" | "refunded";
const PHASES: Phase[] = ["scheduled", "minting", "graduated", "refunded"];

interface RealProps {
  asset: string;
  fm: Fairminter;
  conforming: boolean;
  phase: Phase;
  blockHeight: number;
  mints: Fairmint[];
  pool: Pool | null;
  priceHistory: PoolSnapshot[];
  xcpUsd: number | null;
}

/**
 * Preview-on-demand (temporary dev tool, replaces the /preview page): a
 * floating pill on every asset page that re-renders the REAL LaunchView in
 * any lifecycle state, fabricating the state-dependent data from the
 * asset's own fairminter — same technique the old simulator used, but
 * against whatever asset you're looking at.
 */
export function PhasePreview(props: RealProps) {
  const [override, setOverride] = useState<Phase | null>(null);
  // Only pass through the real props when they already ARE the full version
  // of the requested state (same phase, conforming chrome and all).
  const shown =
    override === null || (override === props.phase && props.conforming)
      ? props
      : fabricate(props, override);

  return (
    <>
      <LaunchView {...shown} />
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 px-1.5 py-1 text-[11px] font-medium shadow-lg backdrop-blur">
        <span className="px-1.5 text-gray-400">preview</span>
        <button
          type="button"
          onClick={() => setOverride(null)}
          className={`rounded-full px-2 py-1 ${
            override === null
              ? "bg-gray-900 text-white"
              : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          live
        </button>
        {PHASES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setOverride(p)}
            className={`rounded-full px-2 py-1 capitalize ${
              override === p
                ? "bg-purple-600 text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Fabrication — ported from the old /preview, parameterized on the    */
/* real fairminter so any asset can wear any state.                    */
/* ------------------------------------------------------------------ */

function fabricate(realProps: RealProps, phase: Phase): RealProps {
  // Previewing a state means previewing the FULL experience of that state,
  // conformance chrome included. A non-conforming asset borrows the ENTIRE
  // XCP-69 economy — blending its real units (indivisible lots, free mints)
  // with standard fallbacks mixes scales and explodes every derived number.
  const H = realProps.blockHeight;
  const borrowAll = !realProps.conforming;
  const fmBase: Fairminter = borrowAll
    ? {
        ...realProps.fm,
        price: XCP69.PRICE,
        quantity_by_price: XCP69.QUANTITY_BY_PRICE,
        soft_cap: XCP69.SOFT_CAP,
        hard_cap: XCP69.HARD_CAP,
        pool_quantity: XCP69.POOL_QUANTITY,
        max_mint_per_tx: XCP69.MAX_MINT_PER_TX,
        max_mint_per_address: XCP69.MAX_MINT_PER_ADDRESS,
        premint_quantity: 0,
        divisible: true,
      }
    : { ...realProps.fm };
  const real = { ...realProps, fm: fmBase, conforming: true };
  const fm = real.fm;
  const qbp = fm.quantity_by_price;
  const mintPrice = fm.price / qbp;
  const softCap = fm.soft_cap;
  const poolQty = fm.pool_quantity || XCP69.POOL_QUANTITY;

  if (phase === "scheduled") {
    return {
      ...real,
      fm: {
        ...fm,
        status: "open",
        start_block: H + 96,
        soft_cap_deadline_block: H + 96 + XCP69.DEADLINE_BLOCKS,
        block_index: H - 48,
        earned_quantity: null,
        paid_quantity: null,
      },
      phase,
      mints: [],
      pool: null,
      priceHistory: [],
    };
  }

  if (phase === "minting") {
    const earned = roundToLot(softCap * 0.42, qbp);
    return {
      ...real,
      fm: {
        ...fm,
        status: "open",
        start_block: H - 156,
        soft_cap_deadline_block: H - 156 + XCP69.DEADLINE_BLOCKS,
        earned_quantity: earned,
        paid_quantity: Math.round(earned * mintPrice),
      },
      phase,
      mints: fakeMints(real.asset, fm.tx_hash, H, qbp, mintPrice, 38, earned),
      pool: null,
      priceHistory: [],
    };
  }

  if (phase === "graduated") {
    const history =
      !borrowAll && real.priceHistory.length > 0
        ? real.priceHistory
        : fakeHistory(real.asset, H, mintPrice, softCap, poolQty);
    const last = history[history.length - 1];
    const pool: Pool =
      !borrowAll && real.pool
        ? real.pool
        : {
            asset_a: real.asset,
            asset_b: "XCP",
            reserve_a: last.reserve_a,
            reserve_b: last.reserve_b,
            lp_asset: fm.lp_asset || "A693330289231613769",
          };
    return {
      ...real,
      fm: {
        ...fm,
        status: "closed",
        start_block: H - 156,
        soft_cap_deadline_block: H - 140, // rewritten to the fill block
        earned_quantity: softCap,
        paid_quantity: Math.round(softCap * mintPrice),
      },
      phase,
      mints:
        !borrowAll && real.mints.length > 0
          ? real.mints
          : fakeMints(real.asset, fm.tx_hash, H, qbp, mintPrice, 74, softCap),
      pool,
      priceHistory: history,
    };
  }

  // refunded: 45% at the deadline — close, but not close enough
  const earned = roundToLot(softCap * 0.45, qbp);
  return {
    ...real,
    fm: {
      ...fm,
      status: "closed",
      start_block: H - 1200,
      soft_cap_deadline_block: H - 200,
      earned_quantity: earned,
      paid_quantity: Math.round(earned * mintPrice),
    },
    phase,
    mints: fakeMints(real.asset, fm.tx_hash, H, qbp, mintPrice, 31, earned),
    pool: null,
    priceHistory: [],
  };
}

function roundToLot(raw: number, qbp: number): number {
  return Math.max(qbp, Math.round(raw / qbp) * qbp);
}

/** Deterministic fake mint tape summing exactly to `totalEarned`. */
function fakeMints(
  asset: string,
  fmTxHash: string,
  height: number,
  qbp: number,
  mintPrice: number,
  count: number,
  totalEarned: number,
): Fairmint[] {
  const mints: Fairmint[] = [];
  let remaining = totalEarned;
  for (let i = 0; i < count; i++) {
    const weight = ((i * 2654435761) % 89) + 12; // deterministic spread
    const rough = Math.round((totalEarned * weight) / ((101 * count) / 2));
    const share =
      i === count - 1 ? remaining : Math.min(remaining, rough - (rough % qbp));
    if (share <= 0) continue;
    remaining -= share;
    mints.push({
      tx_hash: `${i.toString(16).padStart(4, "0")}${"e".repeat(60)}`,
      block_index: height - 150 + i * 3,
      source: `bc1qminter${(i * 7919).toString(36).padStart(6, "0")}preview${i}`,
      fairminter_tx_hash: fmTxHash,
      asset,
      earn_quantity: share,
      paid_quantity: Math.round(share * mintPrice),
      commission: 0,
      status: "valid",
    });
  }
  return mints.reverse();
}

/** Synthetic price walk: opens at the pool ratio, wanders up to ~7.5×. */
function fakeHistory(
  asset: string,
  height: number,
  mintPrice: number,
  softCap: number,
  poolQty: number,
): PoolSnapshot[] {
  const xcpRaised = softCap * mintPrice;
  const k = poolQty * xcpRaised;
  const openMult = xcpRaised / poolQty / mintPrice;
  const snapshots: PoolSnapshot[] = [];
  for (let i = 0; i < 48; i++) {
    const t = i / 47;
    const mult = Math.max(
      0.9,
      openMult + (7.5 - openMult) * t + Math.sin(i * 1.7) * 1.1 * (0.3 + t),
    );
    const price = mult * mintPrice;
    snapshots.push({
      block_index: height - 140 + i * 3,
      tx_index: 4_207_000 + i,
      asset_a: asset,
      asset_b: "XCP",
      reserve_a: Math.round(Math.sqrt(k / price)),
      reserve_b: Math.round(Math.sqrt(k * price)),
    });
  }
  return snapshots;
}
