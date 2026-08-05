"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/**
 * Provider test harness: exercises every method the XCP Wallet provider exposes
 * and every Counterparty message type that produces a distinct approval screen.
 *
 * Compose-and-sign actions stop at the signature — nothing is broadcast unless
 * "Broadcast after signing" is ticked — so the approval screens can be reviewed
 * without spending anything.
 */

type Params = Record<string, string | number | boolean>;

interface TestCase {
  id: string;
  label: string;
  /** What the approval screen should show, so it can be checked against reality. */
  expect: string;
  composeType: string;
  params: (ctx: Ctx) => Params;
  /** Resolves live chain state (e.g. a real open order) before composing. */
  prepare?: (ctx: Ctx) => Promise<Params>;
  /** Composed against a UTXO endpoint rather than the address endpoint. */
  utxo?: boolean;
  danger?: boolean;
}

interface Ctx {
  address: string;
  counterparty: string;
  asset: string;
  divisibleAsset: string;
  destination: string;
  utxo: string;
}

const GROUPS: { title: string; note?: string; cases: TestCase[] }[] = [
  {
    title: "Sends",
    cases: [
      {
        id: "send-divisible",
        label: "Send divisible (XCP)",
        expect: "Send 0.00001000 XCP to <destination>",
        composeType: "send",
        params: (c) => ({ destination: c.destination, asset: c.divisibleAsset, quantity: 1000 }),
      },
      {
        id: "send-indivisible",
        label: "Send indivisible asset",
        expect: "Send 1 <asset> — whole units, no decimals",
        composeType: "send",
        params: (c) => ({ destination: c.destination, asset: c.asset, quantity: 1 }),
      },
      {
        id: "send-memo",
        label: "Send with memo",
        expect: "Same as send; memo shown in details",
        composeType: "send",
        params: (c) => ({
          destination: c.destination,
          asset: c.divisibleAsset,
          quantity: 1000,
          memo: "provider test",
        }),
      },
      {
        id: "mpma",
        label: "MPMA (multi-destination send)",
        expect: "Multiple recipients listed",
        composeType: "mpma",
        params: (c) => ({
          destinations: `${c.destination},${c.address}`,
          assets: `${c.divisibleAsset},${c.divisibleAsset}`,
          quantities: "1000,1000",
        }),
      },
    ],
  },
  {
    title: "DEX",
    cases: [
      {
        id: "order",
        label: "Order (sell asset for XCP)",
        expect: "DEX Order: Give … for …",
        composeType: "order",
        params: (c) => ({
          give_asset: c.divisibleAsset,
          give_quantity: 1000,
          get_asset: "PEPECASH",
          get_quantity: 1000,
          expiration: 1000,
          fee_required: 0,
        }),
      },
      {
        id: "cancel",
        label: "Cancel order",
        expect: "Cancel Order: <hash> — uses your first open order",
        composeType: "cancel",
        params: () => ({}),
        prepare: async (c) => {
          const res = await fetch(
            `${c.counterparty}/addresses/${c.address}/orders?status=open&limit=1&verbose=true`,
          );
          const hash = (await res.json())?.result?.[0]?.tx_hash;
          if (!hash) throw new Error("no open orders on this address to cancel");
          return { offer_hash: hash };
        },
      },
    ],
  },
  {
    title: "Dispensers",
    cases: [
      {
        id: "dispenser",
        label: "Create dispenser",
        expect: "Create Dispenser: N <asset> per N sats",
        composeType: "dispenser",
        params: (c) => ({
          asset: c.asset,
          give_quantity: 1,
          escrow_quantity: 1,
          mainchainrate: 10000,
          status: 0,
        }),
      },
      {
        id: "dispense",
        label: "Dispense (trigger)",
        expect: "Trigger a dispenser — no 'undefined' (PR #255)",
        composeType: "dispense",
        params: (c) => ({ dispenser: c.destination, quantity: 10000 }),
      },
    ],
  },
  {
    title: "Assets",
    cases: [
      {
        id: "issuance",
        label: "Issue numeric asset",
        expect: "Issue Asset: A… (N units)",
        composeType: "issuance",
        params: () => ({
          asset: `A${Math.floor(Math.random() * 1e9) + 26 ** 12 + 1}`,
          quantity: 1000,
          divisible: false,
          description: "provider test",
        }),
      },
      {
        id: "dividend",
        label: "Pay dividend",
        expect: "Pay Dividend: N XCP per <asset>",
        composeType: "dividend",
        params: (c) => ({
          asset: c.asset,
          dividend_asset: c.divisibleAsset,
          quantity_per_unit: 1,
        }),
      },
      {
        id: "destroy",
        label: "Destroy asset",
        expect: "DANGER banner: irreversible destruction",
        composeType: "destroy",
        params: (c) => ({ asset: c.asset, quantity: 1, tag: "test" }),
        danger: true,
      },
    ],
  },
  {
    title: "UTXO",
    note: "Attach/detach/move exercise the UTXO-bound asset paths.",
    cases: [
      {
        id: "attach",
        label: "Attach asset to UTXO",
        expect: "Attach N <asset> to UTXO",
        composeType: "attach",
        params: (c) => ({ asset: c.asset, quantity: 1 }),
      },
      {
        id: "detach",
        label: "Detach from UTXO",
        expect: "Detach assets from UTXO (needs an asset-bearing UTXO)",
        composeType: "detach",
        params: () => ({}),
        utxo: true,
      },
      {
        id: "move",
        label: "Move UTXO",
        expect: "Move UTXO to <destination>",
        composeType: "movetoutxo",
        params: (c) => ({ destination: c.destination }),
        utxo: true,
      },
    ],
  },
  {
    title: "Pools (AMM)",
    cases: [
      {
        id: "pooldeposit",
        label: "Pool deposit",
        expect: "Deposit liquidity: N X and N Y",
        composeType: "pooldeposit",
        params: (c) => ({
          asset_a: c.divisibleAsset,
          asset_b: "PEPECASH",
          quantity_a: 1000,
          quantity_b: 1000,
          min_lp_quantity: 0,
        }),
      },
      {
        id: "poolwithdraw",
        label: "Pool withdraw",
        expect: "Withdraw liquidity: burn N LP",
        composeType: "poolwithdraw",
        params: () => ({
          lp_asset: "A6900000000000001774",
          quantity: 1,
          min_quantity_a: 0,
          min_quantity_b: 0,
        }),
      },
    ],
  },
  {
    title: "Large payloads → bare multisig",
    note: "These outgrow OP_RETURN, so the message rides in multisig data outputs — the case PR #254 relabels as 'Protocol data (recoverable)'.",
    cases: [
      {
        id: "broadcast",
        label: "Broadcast text",
        expect: "Broadcast: <text>",
        composeType: "broadcast",
        params: () => ({
          text: "provider test broadcast — a longer message to push the payload past OP_RETURN",
          value: 0,
          fee_fraction: 0,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      },
      {
        id: "fairminter",
        label: "Fairminter (XCP-69 shape)",
        expect: "Create Fairminter: <asset> + 3 protocol data outputs",
        composeType: "fairminter",
        params: () => ({
          asset: `A${Math.floor(Math.random() * 1e9) + 26 ** 12 + 1}`,
          price: 1000000,
          quantity_by_price: 100000000000,
          hard_cap: 10000000000000000,
          soft_cap: 6900000000000000,
          max_mint_per_tx: 100000000000000,
          max_mint_per_address: 100000000000000,
          premint_quantity: 0,
          lock_quantity: true,
          divisible: true,
        }),
      },
    ],
  },
  {
    title: "Should be blocked or flagged",
    note: "These verify the guards fire, not that they succeed.",
    cases: [
      {
        id: "sweep",
        label: "Sweep (must be BLOCKED)",
        expect: "Signing blocked entirely — sweep drains all assets",
        composeType: "sweep",
        params: (c) => ({ destination: c.destination, flags: 1, memo: "test" }),
        danger: true,
      },
    ],
  },
];

export default function ProviderTestPage() {
  const wallet = useWallet();
  const [asset, setAsset] = useState("BONPARTY");
  const [divisibleAsset, setDivisibleAsset] = useState("XCP");
  const [destination, setDestination] = useState(
    "bc1qtsenny4t24882u7l854yzt0h2znq686mwhf2mt",
  );
  const [utxo, setUtxo] = useState("");
  const [broadcast, setBroadcast] = useState(false);
  const [log, setLog] = useState<
    { id: string; status: "pending" | "ok" | "err"; text: string }[]
  >([]);

  const push = (id: string, status: "pending" | "ok" | "err", text: string) =>
    setLog((l) => [{ id, status, text }, ...l].slice(0, 40));

  const run = async (tc: TestCase) => {
    if (!wallet.address) return;
    push(tc.id, "pending", `${tc.label}: composing…`);
    try {
      const ctx: Ctx = {
        address: wallet.address,
        counterparty: COUNTERPARTY_API_BASE,
        asset,
        divisibleAsset,
        destination,
        utxo,
      };
      const params = tc.prepare ? await tc.prepare(ctx) : tc.params(ctx);
      const qp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) qp.set(k, String(v));
      qp.set("sat_per_vbyte", "2");
      qp.set("verbose", "true");
      if (!tc.utxo) qp.set("exclude_utxos_with_balances", "true");

      const base = tc.utxo
        ? `${COUNTERPARTY_API_BASE}/utxos/${utxo}/compose/${tc.composeType}`
        : `${COUNTERPARTY_API_BASE}/addresses/${wallet.address}/compose/${tc.composeType}`;
      const res = await fetch(`${base}?${qp}`);
      const data = await res.json();
      if (!res.ok || data.error || !data.result?.rawtransaction) {
        throw new Error(data.error ?? `compose failed (${res.status})`);
      }

      push(tc.id, "pending", `${tc.label}: awaiting signature…`);
      const signed = await wallet.signTransaction(data.result.rawtransaction);

      if (broadcast) {
        const txid = await wallet.broadcastTransaction(signed);
        push(tc.id, "ok", `${tc.label}: BROADCAST ${txid}`);
      } else {
        push(tc.id, "ok", `${tc.label}: signed (not broadcast), ${signed.length / 2} bytes`);
      }
    } catch (e) {
      push(tc.id, "err", `${tc.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runMethod = async (label: string, fn: () => Promise<unknown>) => {
    push(label, "pending", `${label}…`);
    try {
      const result = await fn();
      push(label, "ok", `${label}: ${JSON.stringify(result)?.slice(0, 160) ?? "ok"}`);
    } catch (e) {
      push(label, "err", `${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Provider test harness</h1>
        <p className="mt-1 text-sm text-gray-600">
          Exercises every provider method and every message type that produces a
          distinct approval screen. Nothing is broadcast unless you tick the box —
          sign and review, or cancel.
        </p>
      </div>

      {/* Connection */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            Status: <strong>{wallet.status}</strong>
            {wallet.address && (
              <span className="ml-2 font-mono text-xs text-gray-600">{wallet.address}</span>
            )}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Btn onClick={() => runMethod("xcp_requestAccounts", () => wallet.connect())}>
              Connect
            </Btn>
            <Btn onClick={() => runMethod("xcp_disconnect", async () => wallet.disconnect())}>
              Disconnect
            </Btn>
            <Btn
              onClick={() =>
                runMethod("xcp_signMessage", () =>
                  wallet.signMessage(`provider test ${new Date().toISOString()}`),
                )
              }
            >
              Sign message
            </Btn>
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <Field label="Indivisible asset" value={asset} onChange={setAsset} />
        <Field label="Divisible asset" value={divisibleAsset} onChange={setDivisibleAsset} />
        <Field label="Destination" value={destination} onChange={setDestination} />
        <Field label="UTXO (txid:vout, for detach/move)" value={utxo} onChange={setUtxo} />
        <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={broadcast}
            onChange={(e) => setBroadcast(e.target.checked)}
          />
          Broadcast after signing <span className="text-xs text-red-600">(spends real funds)</span>
        </label>
      </div>

      {/* Cases */}
      {GROUPS.map((g) => (
        <div key={g.title} className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">{g.title}</h2>
          {g.note && <p className="mt-1 text-xs text-gray-500">{g.note}</p>}
          <div className="mt-3 space-y-2">
            {g.cases.map((tc) => (
              <div key={tc.id} className="flex items-start gap-3">
                <Btn
                  onClick={() => run(tc)}
                  disabled={wallet.status !== "connected"}
                  danger={tc.danger}
                >
                  {tc.label}
                </Btn>
                <span className="pt-1.5 text-xs text-gray-500">{tc.expect}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Log */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold">Log</h2>
        {log.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {log.map((l, i) => (
              <li
                key={i}
                className={
                  l.status === "ok"
                    ? "text-green-700"
                    : l.status === "err"
                      ? "text-red-600"
                      : "text-gray-500"
                }
              >
                {l.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "bg-red-600 hover:bg-red-500" : "bg-gray-900 hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-gray-300 p-2 font-mono text-xs outline-none focus:border-purple-500"
      />
    </div>
  );
}
