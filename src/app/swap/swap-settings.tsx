"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { GearPopover } from "@/components/ui/popover";
import { fetchMedianFeeRate } from "@/lib/wallet/useCompose";

/** Market orders live one block: match at confirmation or refund next block. */
export const MARKET_EXPIRATION = 1;
const SLIPPAGE_PRESETS = [0.5, 1, 2];
/** Liquidity slippage is looser by convention — deposits drift with every
 *  pool trade, and a breach is benign (void tx, nothing debited). */
const LQ_SLIPPAGE_PRESETS = [0.5, 1, 2.5];
const LQ_DEFAULT_SLIPPAGE = 2.5;
/** Resting-order lifetimes, in blocks. */
export const LIMIT_EXPIRATIONS = [
  { blocks: 144, label: "~1 day" },
  { blocks: 1000, label: "~1 week" },
  { blocks: 5000, label: "~5 weeks" },
];

/**
 * Swap settings lifted out of the widget so the gear can live beside the
 * Swap | Liquidity tabs (the Uniswap placement) while the widget consumes
 * the values. Auto slippage is the default: the widget publishes what the
 * current trade needs (derived from its price impact) via setAutoValue,
 * and Auto tracks it; presets or a custom value opt out.
 */
interface SwapSettingsValue {
  slippageAuto: boolean;
  setSlippageAuto: (v: boolean) => void;
  slippagePreset: number;
  setSlippagePreset: (v: number) => void;
  customSlippage: string;
  setCustomSlippage: (v: string) => void;
  customExpiration: string;
  setCustomExpiration: (v: string) => void;
  customFeeRate: string;
  setCustomFeeRate: (v: string) => void;
  medianFeeRate: number | undefined;
  autoValue: number;
  setAutoValue: (v: number) => void;
  /** Liquidity's own slippage channel (looser defaults). */
  lqSlippagePreset: number;
  setLqSlippagePreset: (v: number) => void;
  lqCustomSlippage: string;
  setLqCustomSlippage: (v: string) => void;
  /** Limit-order lifetime in blocks. */
  limitExpiration: number;
  setLimitExpiration: (v: number) => void;
  /** Derived */
  customSlip: number;
  slippage: number;
  expiration: number;
  customFee: number;
  lqCustomSlip: number;
  lqSlippage: number;
}

const SwapSettingsContext = createContext<SwapSettingsValue | null>(null);

export function useSwapSettings(): SwapSettingsValue {
  const ctx = useContext(SwapSettingsContext);
  if (!ctx)
    throw new Error("useSwapSettings must be used within SwapSettingsProvider");
  return ctx;
}

export function SwapSettingsProvider({ children }: { children: ReactNode }) {
  const [slippageAuto, setSlippageAuto] = useState(true);
  const [slippagePreset, setSlippagePreset] = useState(1);
  const [customSlippage, setCustomSlippage] = useState("");
  const [customExpiration, setCustomExpiration] = useState("");
  const [customFeeRate, setCustomFeeRate] = useState("");
  const [autoValue, setAutoValue] = useState(1);
  const [lqSlippagePreset, setLqSlippagePreset] = useState(LQ_DEFAULT_SLIPPAGE);
  const [lqCustomSlippage, setLqCustomSlippage] = useState("");
  const [limitExpiration, setLimitExpiration] = useState(1000);

  const { data: medianFeeRate } = useSWR("btc-feerate", fetchMedianFeeRate, {
    refreshInterval: 30_000,
  });

  const value = useMemo<SwapSettingsValue>(() => {
    const customSlip = Math.min(parseFloat(customSlippage) || 0, 50);
    const slippage = slippageAuto
      ? autoValue
      : customSlip > 0
        ? customSlip
        : slippagePreset;
    const expiration = Math.min(
      5000,
      Math.max(1, Math.round(parseFloat(customExpiration)) || MARKET_EXPIRATION),
    );
    const customFee = Math.min(Math.round(parseFloat(customFeeRate) || 0), 500);
    const lqCustomSlip = Math.min(parseFloat(lqCustomSlippage) || 0, 50);
    const lqSlippage = lqCustomSlip > 0 ? lqCustomSlip : lqSlippagePreset;
    return {
      slippageAuto,
      setSlippageAuto,
      slippagePreset,
      setSlippagePreset,
      customSlippage,
      setCustomSlippage,
      customExpiration,
      setCustomExpiration,
      customFeeRate,
      setCustomFeeRate,
      medianFeeRate,
      autoValue,
      setAutoValue,
      lqSlippagePreset,
      setLqSlippagePreset,
      lqCustomSlippage,
      setLqCustomSlippage,
      limitExpiration,
      setLimitExpiration,
      customSlip,
      slippage,
      expiration,
      customFee,
      lqCustomSlip,
      lqSlippage,
    };
  }, [
    slippageAuto,
    slippagePreset,
    customSlippage,
    customExpiration,
    customFeeRate,
    medianFeeRate,
    autoValue,
    lqSlippagePreset,
    lqCustomSlippage,
    limitExpiration,
  ]);

  return (
    <SwapSettingsContext value={value}>{children}</SwapSettingsContext>
  );
}

/** The gear beside the mode tabs — render inside SwapSettingsProvider. */
export function SwapSettingsGear() {
  const s = useSwapSettings();
  return (
    <GearPopover
      active={
        !s.slippageAuto ||
        s.expiration !== MARKET_EXPIRATION ||
        s.customFee > 0
      }
      label="Swap settings"
    >
      <div className="text-xs font-medium text-gray-500">Max slippage</div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            s.setSlippageAuto(true);
            s.setCustomSlippage("");
          }}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
            s.slippageAuto
              ? "border-purple-600 bg-purple-50 text-purple-700"
              : "border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
        >
          Auto
        </button>
        {SLIPPAGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              s.setSlippageAuto(false);
              s.setSlippagePreset(p);
              s.setCustomSlippage("");
            }}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              !s.slippageAuto && s.slippage === p && s.customSlip === 0
                ? "border-purple-600 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {p}%
          </button>
        ))}
        <div
          className={`flex items-center rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
            !s.slippageAuto && s.customSlip > 0
              ? "border-purple-600 bg-purple-50"
              : "border-gray-200"
          }`}
        >
          <AmountInput
            value={s.customSlippage}
            onChange={(v) => {
              s.setCustomSlippage(v);
              if (v.trim() !== "") s.setSlippageAuto(false);
            }}
            placeholder="1.5"
            ariaLabel="Custom slippage percent"
            className="w-8 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>
      {s.slippageAuto ? (
        <p className="mt-2 text-[11px] text-gray-400">
          Auto sizes slippage to the trade: what this quote needs, currently ~
          {s.autoValue}%.
        </p>
      ) : s.slippage >= 20 ? (
        <p className="mt-2 text-[11px] font-medium text-red-600">
          {s.slippage}% slippage authorizes a very unfavorable fill. The
          button will warn before swapping.
        </p>
      ) : s.slippage > 5 ? (
        <p className="mt-2 text-[11px] text-red-600">
          High slippage authorizes up to {s.slippage}% price impact.
        </p>
      ) : s.slippage < 0.5 ? (
        <p className="mt-2 text-[11px] text-amber-600">
          Below 0.5% the order may not fill.
        </p>
      ) : s.slippage > s.autoValue ? (
        <p className="mt-2 text-[11px] text-amber-600">
          Higher than this trade needs (~{s.autoValue}%).
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">Expiration</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
            s.expiration !== MARKET_EXPIRATION
              ? "border-purple-600 bg-purple-50"
              : "border-gray-200"
          }`}
        >
          <AmountInput
            value={s.customExpiration}
            onChange={s.setCustomExpiration}
            placeholder={String(MARKET_EXPIRATION)}
            ariaLabel="Order expiration in blocks"
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400">blocks</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
        How long an unfilled remainder rests before auto-refund.{" "}
        {MARKET_EXPIRATION} = fill at confirmation or refund next block.
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">TX fee</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
            s.customFee > 0 ? "border-purple-600 bg-purple-50" : "border-gray-200"
          }`}
        >
          <AmountInput
            value={s.customFeeRate}
            onChange={s.setCustomFeeRate}
            placeholder={s.medianFeeRate ? String(s.medianFeeRate) : "…"}
            ariaLabel="Bitcoin fee rate in sats per vbyte"
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400">sat/vB</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
        The Bitcoin miner fee. Default tracks the next-block median.
      </p>
      <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
        Min received is enforced by the order itself — worse fills are
        impossible; better ones refund the difference.
      </div>
    </GearPopover>
  );
}

/** The gear for the Limit tab — order lifetime + shared TX fee. */
export function LimitSettingsGear() {
  const s = useSwapSettings();
  return (
    <GearPopover
      active={s.limitExpiration !== 1000 || s.customFee > 0}
      label="Limit order settings"
    >
      <div className="text-xs font-medium text-gray-500">Expiration</div>
      <div className="mt-2 flex items-center gap-1.5">
        {LIMIT_EXPIRATIONS.map((x) => (
          <button
            key={x.blocks}
            type="button"
            onClick={() => s.setLimitExpiration(x.blocks)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              s.limitExpiration === x.blocks
                ? "border-purple-600 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        How long the order rests unfilled before the remainder auto-refunds.
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">TX fee</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
            s.customFee > 0 ? "border-purple-600 bg-purple-50" : "border-gray-200"
          }`}
        >
          <AmountInput
            value={s.customFeeRate}
            onChange={s.setCustomFeeRate}
            placeholder={s.medianFeeRate ? String(s.medianFeeRate) : "…"}
            ariaLabel="Bitcoin fee rate in sats per vbyte"
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400">sat/vB</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
        The Bitcoin miner fee. Default tracks the next-block median.
      </p>
      <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
        A resting order refunds in full at expiry — the price you set is
        enforced by the order itself.
      </div>
    </GearPopover>
  );
}

/** The gear for the Liquidity tab — its own looser slippage, shared TX fee. */
export function LiquiditySettingsGear() {
  const s = useSwapSettings();
  return (
    <GearPopover
      active={s.lqCustomSlip > 0 || s.customFee > 0}
      label="Liquidity settings"
    >
      <div className="text-xs font-medium text-gray-500">Max slippage</div>
      <div className="mt-2 flex items-center gap-1.5">
        {LQ_SLIPPAGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              s.setLqSlippagePreset(p);
              s.setLqCustomSlippage("");
            }}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              s.lqSlippage === p && s.lqCustomSlip === 0
                ? "border-purple-600 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {p}%
          </button>
        ))}
        <div
          className={`flex items-center rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
            s.lqCustomSlip > 0
              ? "border-purple-600 bg-purple-50"
              : "border-gray-200"
          }`}
        >
          <AmountInput
            value={s.lqCustomSlippage}
            onChange={s.setLqCustomSlippage}
            placeholder="5"
            ariaLabel="Custom liquidity slippage percent"
            className="w-8 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        If the pool moves past this before confirmation, the whole
        transaction is void — nothing is debited; only the miner fee is
        spent.
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">TX fee</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
            s.customFee > 0 ? "border-purple-600 bg-purple-50" : "border-gray-200"
          }`}
        >
          <AmountInput
            value={s.customFeeRate}
            onChange={s.setCustomFeeRate}
            placeholder={s.medianFeeRate ? String(s.medianFeeRate) : "…"}
            ariaLabel="Bitcoin fee rate in sats per vbyte"
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400">sat/vB</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
        The Bitcoin miner fee. Default tracks the next-block median.
      </p>
    </GearPopover>
  );
}
