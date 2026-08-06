"use client";

import { useRef, useState } from "react";
import type { Dispenser } from "@/lib/api/counterparty";
import { shortAddress } from "@/lib/format";
import { registerPending } from "@/lib/pending";
import { fetchPriorityFeeRate } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Multi-dispense router: fills one load across up to MAX_LEGS dispensers as
 * SEPARATE transactions, signed and broadcast serially (one wallet popup
 * per leg).
 *
 * The composer would double-spend by default — UTXOs are sorted largest-
 * first and selection is deterministic, and its in-process lock lives only
 * 3 seconds, far shorter than a human approval. So each leg is composed
 * with an explicit disjoint UTXO via inputs_set. When the wallet lacks
 * enough disjoint UTXOs, legs chain instead: each later leg excludes the
 * spent inputs and spends mempool change via allow_unconfirmed_inputs.
 *
 * The extension rate-limits sign+broadcast to 10/origin/minute — 3 legs =
 * 6 calls, the ceiling that motivates MAX_LEGS = 3. A re-sign of the SAME
 * hex is deduped by the wallet (rejoins the open popup or replays the
 * result), which is what makes per-leg Retry safe.
 */

export const MAX_LEGS = 3;
/** Rough vbytes of a dispense tx, for the per-leg fee reserve. */
const FEE_VBYTES = 300;
/** Breather between legs: lets the wallet's popup monitor (5s close-grace) settle. */
const INTER_LEG_DELAY_MS = 1200;

export interface PlannedLeg {
  dispenser: Dispenser;
  units: number;
  btcSats: number;
}

export type LegStatus =
  | "pending"
  | "composing"
  | "signing"
  | "broadcasting"
  | "done"
  | "error";

export interface Leg extends PlannedLeg {
  status: LegStatus;
  rawHex: string | null;
  txid: string | null;
  error: string | null;
  /** Disjoint UTXO assigned at plan time (txid:vout); absent for chained legs. */
  utxoAssigned?: string;
}

export type RouterPhase = "idle" | "running" | "done" | "partial";

interface Utxo {
  txid: string;
  vout: number;
  value: number;
}

async function fetchConfirmedUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`https://mempool.space/api/address/${address}/utxo`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error("Couldn't read your BTC coins (UTXOs)");
  const rows: {
    txid: string;
    vout: number;
    value: number;
    status: { confirmed: boolean };
  }[] = await res.json();
  return rows
    .filter((r) => r.status.confirmed)
    .map((r) => ({ txid: r.txid, vout: r.vout, value: r.value }))
    .sort((a, b) => b.value - a.value);
}

async function composeLeg(
  address: string,
  leg: PlannedLeg,
  feeRate: number,
  opts: { inputsSet?: string; excludeUtxos?: string[]; allowUnconfirmed?: boolean },
): Promise<string> {
  const qp = new URLSearchParams({
    dispenser: leg.dispenser.source,
    quantity: String(leg.btcSats),
    sat_per_vbyte: String(feeRate),
    exclude_utxos_with_balances: "true",
    verbose: "true",
  });
  if (opts.inputsSet) qp.set("inputs_set", opts.inputsSet);
  if (opts.excludeUtxos?.length) qp.set("exclude_utxos", opts.excludeUtxos.join(","));
  if (opts.allowUnconfirmed) qp.set("allow_unconfirmed_inputs", "true");

  const url = `${COUNTERPARTY_API_BASE}/addresses/${address}/compose/dispense?${qp}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.description ?? data.error ?? `Compose failed (${res.status})`);
  }
  return data.result.rawtransaction as string;
}

/** Live re-check of one dispenser right before composing its leg. */
async function preflightLeg(leg: PlannedLeg): Promise<string | null> {
  try {
    const res = await fetch(
      `${COUNTERPARTY_API_BASE}/addresses/${leg.dispenser.source}/dispensers`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const rows: {
      asset: string;
      status: number;
      give_remaining: number;
      satoshirate: number;
    }[] = res.ok ? ((await res.json()).result ?? []) : [];
    const live = rows.find((r) => r.asset === "XCP");
    if (!live || live.status !== 0) return "route just closed";
    if (live.satoshirate !== leg.dispenser.satoshirate) return "route price changed";
    if (live.give_remaining < leg.units * leg.dispenser.give_quantity)
      return "route no longer has enough left";
    return null;
  } catch {
    return null; // can't verify — compose-time validation still applies
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useDispenseRouter() {
  const { address, signTransaction, broadcastTransaction } = useWallet();
  const [legs, setLegs] = useState<Leg[]>([]);
  const [phase, setPhase] = useState<RouterPhase>("idle");
  const [planError, setPlanError] = useState<string | null>(null);
  const legsRef = useRef<Leg[]>([]);
  const chainModeRef = useRef(false);
  const usedInputsRef = useRef<string[]>([]);
  const feeRateRef = useRef(3);
  const runningRef = useRef(false);

  const sync = () => setLegs([...legsRef.current]);
  const patch = (i: number, p: Partial<Leg>) => {
    legsRef.current[i] = { ...legsRef.current[i], ...p };
    sync();
  };

  /** Run legs from startIdx to completion (or first hard stop). */
  const run = async (startIdx: number) => {
    if (!address || runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    try {
      for (let i = startIdx; i < legsRef.current.length; i++) {
        const leg = legsRef.current[i];
        if (leg.status === "done") continue;
        if (i > startIdx) await sleep(INTER_LEG_DELAY_MS);

        try {
          // Compose (unless retrying an already-composed hex — same hex
          // re-sign is deduped by the wallet, so reuse it).
          let rawHex = leg.rawHex;
          if (!rawHex) {
            patch(i, { status: "composing", error: null });
            const stale = await preflightLeg(leg);
            if (stale) throw new Error(`Skipped: ${stale}`);
            rawHex = await composeLeg(address, leg, feeRateRef.current, {
              inputsSet: leg.utxoAssigned,
              excludeUtxos:
                chainModeRef.current && !leg.utxoAssigned
                  ? usedInputsRef.current
                  : undefined,
              allowUnconfirmed: chainModeRef.current && !leg.utxoAssigned,
            });
            patch(i, { rawHex });
          }

          patch(i, { status: "signing", error: null });
          const signedHex = await signTransaction(rawHex);

          patch(i, { status: "broadcasting" });
          const txid = await broadcastTransaction(signedHex);
          patch(i, { status: "done", txid });
          registerPending({
            txid,
            kind: "dispense",
            label: `Load ${leg.units * (leg.dispenser.give_quantity / 1e8)} XCP via ${shortAddress(leg.dispenser.source)}`,
          });
        } catch (e) {
          patch(i, {
            status: "error",
            error: e instanceof Error ? e.message : "Failed",
          });
          setPhase("partial");
          runningRef.current = false;
          return;
        }
      }
      setPhase(legsRef.current.every((l) => l.status === "done") ? "done" : "partial");
    } finally {
      runningRef.current = false;
    }
  };

  const start = async (planned: PlannedLeg[]) => {
    if (!address || planned.length === 0 || runningRef.current) return;
    setPlanError(null);
    setPhase("running");
    legsRef.current = planned.map((p) => ({
      ...p,
      status: "pending" as const,
      rawHex: null,
      txid: null,
      error: null,
      utxoAssigned: undefined,
    }));
    sync();

    try {
      feeRateRef.current = await fetchPriorityFeeRate();
      const utxos = await fetchConfirmedUtxos(address);
      const reserve = feeRateRef.current * FEE_VBYTES;
      const totalNeeded = planned.reduce((s, l) => s + l.btcSats + reserve, 0);
      const totalHave = utxos.reduce((s, u) => s + u.value, 0);
      if (totalHave < totalNeeded) {
        throw new Error(
          `Not enough BTC: this load needs ~${(totalNeeded / 1e8).toFixed(8)} BTC including fees`,
        );
      }

      // Partition: best-fit one disjoint UTXO per leg (largest legs first).
      const pool = [...utxos];
      const order = [...legsRef.current.keys()].sort(
        (a, b) => legsRef.current[b].btcSats - legsRef.current[a].btcSats,
      );
      let partitioned = true;
      for (const idx of order) {
        const need = legsRef.current[idx].btcSats + reserve;
        let best = -1;
        for (let u = 0; u < pool.length; u++) {
          if (pool[u].value >= need && (best === -1 || pool[u].value < pool[best].value))
            best = u;
        }
        if (best === -1) {
          partitioned = false;
          break;
        }
        legsRef.current[idx] = {
          ...legsRef.current[idx],
          utxoAssigned: `${pool[best].txid}:${pool[best].vout}`,
        };
        pool.splice(best, 1);
      }

      chainModeRef.current = !partitioned;
      if (!partitioned) {
        // Chain mode: leg 0 pins the largest UTXO; later legs exclude it
        // and spend mempool change via allow_unconfirmed_inputs.
        legsRef.current = legsRef.current.map((l, i) => ({
          ...l,
          utxoAssigned: i === 0 ? `${utxos[0].txid}:${utxos[0].vout}` : undefined,
        }));
        usedInputsRef.current = [`${utxos[0].txid}:${utxos[0].vout}`];
      } else {
        usedInputsRef.current = legsRef.current
          .map((l) => l.utxoAssigned)
          .filter((u): u is string => Boolean(u));
      }
      sync();
      await run(0);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Planning failed");
      setPhase(legsRef.current.some((l) => l.status === "done") ? "partial" : "idle");
    }
  };

  /** Retry a failed leg (and continue any legs after it). */
  const retry = (idx: number) => {
    if (runningRef.current) return;
    patch(idx, { status: "pending", error: null });
    run(idx);
  };

  const reset = () => {
    if (runningRef.current) return;
    legsRef.current = [];
    usedInputsRef.current = [];
    chainModeRef.current = false;
    setLegs([]);
    setPhase("idle");
    setPlanError(null);
  };

  return { legs, phase, planError, start, retry, reset };
}
