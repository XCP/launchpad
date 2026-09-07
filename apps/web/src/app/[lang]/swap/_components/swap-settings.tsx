"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { parseBoundedSetting } from "@/lib/amount-draft";
import { GearPopover } from "@/components/ui/popover";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { msg } from "@/lib/i18n/t";
import { fetchFeeRate } from "@xcp/wallet-sdk";
import {
  readSettings,
  readSettingsServer,
  subscribeSettings,
  updateSettings,
} from "@/app/[lang]/swap/_lib/trade-settings-store";

/** Shortest configured order lifetime; protocol expiry returns unfilled amounts. */
export const MARKET_EXPIRATION = 1;
const SLIPPAGE_PRESETS = [0.5, 1, 2];
/** Deposits drift with every pool trade. A breached limit invalidates the
 *  liquidity operation; the Bitcoin network fee is still paid. */
const LQ_SLIPPAGE_PRESETS = [0.5, 1, 2.5];
/** Resting-order lifetimes, in blocks. */
export const LIMIT_EXPIRATIONS = [
  { blocks: 144, label: msg("~1 day") },
  { blocks: 1000, label: msg("~1 week") },
  { blocks: 5000, label: msg("~5 weeks") },
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
  customFee: number | null;
  swapSettingsValid: boolean;
  limitSettingsValid: boolean;
  liquiditySettingsValid: boolean;
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
  // Persisted settings live in the external store (localStorage-backed,
  // cross-tab); autoValue is per-surface quote state and stays local.
  const stored = useSyncExternalStore(
    subscribeSettings,
    readSettings,
    readSettingsServer,
  );
  const [autoValue, setAutoValue] = useState(1);

  const { data: medianFeeRate } = useSWR("btc-feerate", fetchFeeRate, {
    refreshInterval: 30_000,
  });

  const value = useMemo<SwapSettingsValue>(() => {
    const {
      slippageAuto,
      slippagePreset,
      customSlippage,
      customExpiration,
      customFeeRate,
      lqSlippagePreset,
      lqCustomSlippage,
      limitExpiration,
    } = stored;
    const slipDraft = parseBoundedSetting(customSlippage, 50);
    const expirationDraft = parseBoundedSetting(customExpiration, 5000, 1, 0);
    const feeDraft = parseBoundedSetting(customFeeRate, 500);
    const lqSlipDraft = parseBoundedSetting(lqCustomSlippage, 50);
    const customSlip = slipDraft.value ?? 0;
    const slippage = slippageAuto
      ? autoValue
      : !slipDraft.empty
        ? customSlip
        : slippagePreset;
    const expiration = expirationDraft.value ?? MARKET_EXPIRATION;
    const customFee = feeDraft.value;
    const lqCustomSlip = lqSlipDraft.value ?? 0;
    const lqSlippage = !lqSlipDraft.empty ? lqCustomSlip : lqSlippagePreset;
    const limitSettingsValid = feeDraft.valid && Number.isInteger(limitExpiration) && limitExpiration >= 1 && limitExpiration <= 5000;
    return {
      slippageAuto,
      setSlippageAuto: (v) => updateSettings({ slippageAuto: v }),
      slippagePreset,
      setSlippagePreset: (v) => updateSettings({ slippagePreset: v }),
      customSlippage,
      setCustomSlippage: (v) => updateSettings({ customSlippage: v }),
      customExpiration,
      setCustomExpiration: (v) => updateSettings({ customExpiration: v }),
      customFeeRate,
      setCustomFeeRate: (v) => updateSettings({ customFeeRate: v }),
      medianFeeRate,
      autoValue,
      setAutoValue,
      lqSlippagePreset,
      setLqSlippagePreset: (v) => updateSettings({ lqSlippagePreset: v }),
      lqCustomSlippage,
      setLqCustomSlippage: (v) => updateSettings({ lqCustomSlippage: v }),
      limitExpiration,
      setLimitExpiration: (v) => updateSettings({ limitExpiration: v }),
      customSlip,
      slippage,
      expiration,
      customFee,
      swapSettingsValid: feeDraft.valid && expirationDraft.valid && slipDraft.valid,
      limitSettingsValid,
      liquiditySettingsValid: feeDraft.valid && lqSlipDraft.valid,
      lqCustomSlip,
      lqSlippage,
    };
  }, [stored, medianFeeRate, autoValue]);

  return (
    <SwapSettingsContext value={value}>{children}</SwapSettingsContext>
  );
}

/** The gear beside the mode tabs — render inside SwapSettingsProvider. */
export function SwapSettingsGear() {
  const num = useNumbers();
  const t = useT();
  const s = useSwapSettings();
  return (
    <GearPopover
      active={
        !s.slippageAuto ||
        s.expiration !== MARKET_EXPIRATION ||
        s.customFee !== null
      }
      label={t("Swap settings")}
    >
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("Max slippage")}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            s.setSlippageAuto(true);
            s.setCustomSlippage("");
          }}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
            s.slippageAuto
              ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300"
              : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
          }`}
        >
          {t("Auto")}
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
              !s.slippageAuto && s.slippage === p && s.customSlippage === ""
                ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300"
                : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            {num.percent(p / 100, { digits: 1 })}
          </button>
        ))}
        <div
          className={`flex min-w-0 items-center rounded-lg border px-2 py-1 has-[[aria-invalid=true]]:basis-full has-[[aria-invalid=true]]:flex-wrap transition-colors focus-within:border-purple-400 dark:focus-within:border-purple-500 ${
            !s.slippageAuto && s.customSlippage !== ""
              ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40"
              : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <AmountInput
            value={s.customSlippage}
            max={50}
            onChange={(v) => {
              s.setCustomSlippage(v);
              if (v !== "") s.setSlippageAuto(false);
            }}
            placeholder="1.5"
            ariaLabel={t("Custom slippage percent")}
            className="w-8 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
        </div>
      </div>
      {!parseBoundedSetting(s.customSlippage, 50).valid ? null : s.slippageAuto ? (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          {t("Auto sizes slippage to the trade: what this quote needs, currently ~{pct}%.", { pct: num.commas(s.autoValue) })}
        </p>
      ) : s.slippage >= 20 ? (
        <p className="mt-2 text-[11px] font-medium text-red-600 dark:text-red-400">
          {t("{pct}% slippage authorizes a very unfavorable fill. The button will warn before swapping.", { pct: num.commas(s.slippage) })}
        </p>
      ) : s.slippage > 5 ? (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
          {t("Slippage tolerance of {pct}% permits receiving less than quoted.", { pct: num.commas(s.slippage) })}
        </p>
      ) : s.slippage < 0.5 ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {t("Below 0.5% the order may not fill.")}
        </p>
      ) : s.slippage > s.autoValue ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {t("Higher than this trade needs (~{pct}%).", { pct: num.commas(s.autoValue) })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("Expiration")}</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 has-[[aria-invalid=true]]:w-full has-[[aria-invalid=true]]:flex-wrap transition-colors focus-within:border-purple-400 dark:focus-within:border-purple-500 ${
            s.expiration !== MARKET_EXPIRATION
              ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40"
              : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <AmountInput
            value={s.customExpiration}
            decimals={0}
            min={1}
            max={5000}
            onChange={s.setCustomExpiration}
            placeholder={String(MARKET_EXPIRATION)}
            ariaLabel={t("Order expiration in blocks")}
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">{t("blocks")}</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("How many blocks an unfilled remainder stays open before expiry. {n} is the shortest setting.", { n: MARKET_EXPIRATION })}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("TX fee")}</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 has-[[aria-invalid=true]]:w-full has-[[aria-invalid=true]]:flex-wrap transition-colors focus-within:border-purple-400 dark:focus-within:border-purple-500 ${
            s.customFee !== null ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40" : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <AmountInput
            value={s.customFeeRate}
            max={500}
            onChange={s.setCustomFeeRate}
            placeholder={s.medianFeeRate ? String(s.medianFeeRate) : "…"}
            ariaLabel={t("Bitcoin fee rate in sats per vbyte")}
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">sat/vB</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("The Bitcoin miner fee. Default tracks the next-block median.")}
      </p>
    </GearPopover>
  );
}

/** The gear for the Limit tab — order lifetime + shared TX fee. */
export function LimitSettingsGear() {
  const t = useT();
  const s = useSwapSettings();
  return (
    <GearPopover
      active={s.limitExpiration !== 1000 || s.customFee !== null}
      label={t("Limit order settings")}
    >
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("Expiration")}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {LIMIT_EXPIRATIONS.map((x) => (
          <button
            key={x.blocks}
            type="button"
            onClick={() => s.setLimitExpiration(x.blocks)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              s.limitExpiration === x.blocks
                ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300"
                : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("How long the order rests unfilled before the remainder auto-refunds.")}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("TX fee")}</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 has-[[aria-invalid=true]]:w-full has-[[aria-invalid=true]]:flex-wrap transition-colors focus-within:border-purple-400 dark:focus-within:border-purple-500 ${
            s.customFee !== null ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40" : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <AmountInput
            value={s.customFeeRate}
            max={500}
            onChange={s.setCustomFeeRate}
            placeholder={s.medianFeeRate ? String(s.medianFeeRate) : "…"}
            ariaLabel={t("Bitcoin fee rate in sats per vbyte")}
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">sat/vB</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("The Bitcoin miner fee. Default tracks the next-block median.")}
      </p>
      <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("Any unfilled amount is returned at expiry. The order enforces your limit price.")}
      </div>
    </GearPopover>
  );
}

/** The gear for the Liquidity tab — its own looser slippage, shared TX fee. */
export function LiquiditySettingsGear() {
  const num = useNumbers();
  const t = useT();
  const s = useSwapSettings();
  return (
    <GearPopover
      active={s.lqCustomSlippage !== "" || s.customFee !== null}
      label={t("Liquidity settings")}
    >
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("Max slippage")}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {LQ_SLIPPAGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              s.setLqSlippagePreset(p);
              s.setLqCustomSlippage("");
            }}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              s.lqSlippage === p && s.lqCustomSlippage === ""
                ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300"
                : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            {num.percent(p / 100, { digits: 1 })}
          </button>
        ))}
        <div
          className={`flex min-w-0 items-center rounded-lg border px-2 py-1 has-[[aria-invalid=true]]:basis-full has-[[aria-invalid=true]]:flex-wrap transition-colors focus-within:border-purple-400 dark:focus-within:border-purple-500 ${
            s.lqCustomSlippage !== ""
              ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40"
              : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <AmountInput
            value={s.lqCustomSlippage}
            max={50}
            onChange={s.setLqCustomSlippage}
            placeholder="5"
            ariaLabel={t("Custom liquidity slippage percent")}
            className="w-8 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("If these limits cannot be met at confirmation, the liquidity operation is invalid. Pool assets are not debited; the Bitcoin network fee is still paid.")}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("TX fee")}</span>
        <span
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 has-[[aria-invalid=true]]:w-full has-[[aria-invalid=true]]:flex-wrap transition-colors focus-within:border-purple-400 dark:focus-within:border-purple-500 ${
            s.customFee !== null ? "border-purple-600 bg-purple-50 dark:bg-purple-950/40" : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <AmountInput
            value={s.customFeeRate}
            max={500}
            onChange={s.setCustomFeeRate}
            placeholder={s.medianFeeRate ? String(s.medianFeeRate) : "…"}
            ariaLabel={t("Bitcoin fee rate in sats per vbyte")}
            className="w-10 bg-transparent text-right text-xs font-medium outline-none"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">sat/vB</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {t("The Bitcoin miner fee. Default tracks the next-block median.")}
      </p>
    </GearPopover>
  );
}
