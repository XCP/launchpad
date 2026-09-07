"use client";

/**
 * Persistent trade settings shared by the swap, limit, and liquidity
 * surfaces. localStorage-backed external store (the pending.ts pattern):
 * stable snapshots for useSyncExternalStore, cross-tab sync via the
 * storage event.
 */

export interface TradeSettings {
  slippageAuto: boolean;
  slippagePreset: number;
  customSlippage: string;
  customExpiration: string;
  customFeeRate: string;
  lqSlippagePreset: number;
  lqCustomSlippage: string;
  limitExpiration: number;
}

export const SETTINGS_DEFAULTS: TradeSettings = {
  slippageAuto: true,
  slippagePreset: 1,
  customSlippage: "",
  customExpiration: "",
  customFeeRate: "",
  lqSlippagePreset: 2.5,
  lqCustomSlippage: "",
  limitExpiration: 1000,
};

const KEY = "xcpfun:trade-settings:v1";
const EVENT = "xcpfun:trade-settings-updated";

let cache: TradeSettings | null = null;

function load(): TradeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SETTINGS_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<TradeSettings>;
    const merged = { ...SETTINGS_DEFAULTS };
    for (const key of Object.keys(SETTINGS_DEFAULTS) as (keyof TradeSettings)[]) {
      const value = parsed[key];
      if (typeof value === typeof SETTINGS_DEFAULTS[key]) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  } catch {
    return SETTINGS_DEFAULTS;
  }
}

export function readSettings(): TradeSettings {
  if (typeof window === "undefined") return SETTINGS_DEFAULTS;
  if (cache === null) cache = load();
  return cache;
}

export function readSettingsServer(): TradeSettings {
  return SETTINGS_DEFAULTS;
}

export function updateSettings(patch: Partial<TradeSettings>) {
  cache = { ...readSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — settings stay per-session
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSettings(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
