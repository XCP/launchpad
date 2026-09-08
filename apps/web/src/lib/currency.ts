"use client";

import { useCallback, useSyncExternalStore } from "react";
import { trackEvent } from "@/lib/analytics";
import { fetchFxRates } from "@/lib/api/launchpad-api";
import { fiat } from "@/lib/format";
import { useNumberLocale } from "@/lib/number-preference";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Which currency the site's fiat figures are shown in.
 *
 * Every money figure on the site is computed in dollars — XCP times the
 * XCP/USD mark — and stays that way; this decides only how the dollars are
 * shown. A visitor whose browser says it is in Japan sees yen, and can
 * override that in the currency picker. Deliberately choosing a language
 * also selects its suggested currency; visiting a translated URL does not.
 * The choice is one more factor and a symbol,
 * applied at the moment of formatting by `useFiat`, so the arithmetic, the
 * returns and the sorts never see it.
 *
 * Same shape as `denomination.ts`: an external store read through
 * useSyncExternalStore, so any component can subscribe without a provider,
 * and the server snapshot is always dollars. Pages are rendered and cached
 * per URL, not per visitor, so the server cannot know the currency; the
 * browser re-formats after hydration, and stores its answer so every visit
 * after the first reads it before first paint.
 *
 * Rates are fetched only when they are needed: a dollar visitor — most of
 * them — never asks the API for a table it would not use.
 */

/** The currencies the ECB feed quotes against the dollar, plus the dollar. */
export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "KRW",
  "INR",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "HKD",
  "SGD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "ISK",
  "TRY",
  "ILS",
  "BRL",
  "MXN",
  "ZAR",
  "THB",
  "MYR",
  "IDR",
  "PHP",
] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Suggestions use only currencies quoted by our FX feed. Spanish serves
 * the Americas as a whole, so USD avoids assuming Mexico or Spain. Taiwan,
 * Russian and Ukrainian locales also use USD until their currencies are
 * supported. A later currency choice remains independent of language. */
const LANGUAGE_CURRENCY: Record<Locale, Currency> = {
  en: "USD",
  ja: "JPY",
  zh: "CNY",
  "zh-tw": "USD",
  "zh-hk": "HKD",
  es: "USD",
  ko: "KRW",
  pt: "BRL",
  fr: "EUR",
  ru: "USD",
  uk: "USD",
};

export function currencyForLocale(locale: Locale): Currency {
  return LANGUAGE_CURRENCY[locale];
}

export interface CurrencyState {
  /** What the visitor should see: their choice, or what was detected. */
  code: Currency;
  /** No explicit choice stored; `code` came from the browser's locale. */
  auto: boolean;
  /** Initial browser suggestion, independent of any explicit choice. */
  detected: Currency;
  /** Units of `code` per dollar. Null until the table has loaded, in which
   *  case figures stay in dollars rather than in a currency at rate 1. */
  rate: number | null;
  /** The ECB day the rate is from; null until loaded or for dollars. */
  date: string | null;
}

const PREF_KEY = "xcpfun:currency:v1";
const FX_KEY = "xcpfun:fx:v1";
/** The ECB publishes once a business day; twice a day is plenty. */
const FX_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FX_RETRY_MS = 60 * 1000;

const SERVER: CurrencyState = {
  code: "USD",
  auto: true,
  detected: "USD",
  rate: 1,
  date: null,
};

function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Auto uses the browser's language and timezone, with dollars as the
 * fallback. Opening a translated URL does not change an existing choice.
 * Choosing a language in the UI explicitly sets its suggested currency;
 * an internal preference reset returns to browser detection. `maximize()` gives a bare
 * browser tag such as "ja" its region.
 */
const REGION_CURRENCY: Record<string, Currency> = { JP: "JPY", HK: "HKD", MO: "HKD", KR: "KRW", BR: "BRL", FR: "EUR", BE: "EUR", LU: "EUR", MC: "EUR" };
const TIMEZONE_CURRENCY: Record<string, Currency> = {
  "Asia/Tokyo": "JPY",
  "Asia/Hong_Kong": "HKD",
  "Asia/Macau": "HKD",
  "Asia/Seoul": "KRW",
  "America/Sao_Paulo": "BRL",
  "Europe/Paris": "EUR",
  "Europe/Brussels": "EUR",
  "Europe/Luxembourg": "EUR",
};

function detect(): Currency {
  if (typeof navigator === "undefined") return "USD";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    try {
      const locale = new Intl.Locale(tag);
      const region = locale.maximize().region ?? "";
      if (locale.language === "ja") return "JPY";
      if (locale.language === "ko") return "KRW";
      if (locale.language === "pt" && region === "BR") return "BRL";
      if (locale.language === "yue") return "HKD";
      if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    } catch {
      // Malformed tag: try the next one.
    }
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONE_CURRENCY[zone]) return TIMEZONE_CURRENCY[zone];
  } catch {
    // No timezone available: language was the only signal.
  }
  return "USD";
}

let preference: Currency | null | undefined;

function readPreference(): Currency | null {
  if (preference !== undefined) return preference;
  try {
    const stored = localStorage.getItem(PREF_KEY);
    preference = isCurrency(stored) ? stored : null;
  } catch {
    preference = null;
  }
  return preference;
}

interface StoredFx {
  fetchedAt: number;
  date: string;
  rates: Record<string, number>;
}

let fx: StoredFx | null | undefined;

function parseFx(raw: string | null): StoredFx | null {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredFx>;
    if (
      typeof parsed.fetchedAt !== "number" ||
      !Number.isFinite(parsed.fetchedAt) ||
      parsed.fetchedAt > Date.now() ||
      typeof parsed.date !== "string" ||
      typeof parsed.rates !== "object" ||
      parsed.rates === null ||
      Array.isArray(parsed.rates)
    ) {
      return null;
    }
    return parsed as StoredFx;
  } catch {
    return null;
  }
}

function readFx(): StoredFx | null {
  if (fx !== undefined) return fx;
  try {
    fx = parseFx(localStorage.getItem(FX_KEY));
  } catch {
    fx = null;
  }
  return fx;
}

let snapshot: CurrencyState | null = null;
let fetching = false;
let retryAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<() => void>();

function compute(): CurrencyState {
  const preference = readPreference();
  const detected = detect();
  const code = preference ?? detected;
  if (code === "USD") return { code, auto: preference === null, detected, rate: 1, date: null };
  const fx = readFx();
  const rate = fx?.rates[code];
  const usableRate = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
  return {
    code,
    auto: preference === null,
    detected,
    rate: usableRate,
    date: usableRate === null ? null : fx?.date ?? null,
  };
}

function clearRefreshTimer() {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

/** One timer and request for the whole store, started by subscriptions, not
 *  renders. A fresh table missing a currency still waits for its TTL. Failed
 *  requests keep any usable rate and retry with a delay, including in a tab
 *  that stays open overnight. */
function refreshRates() {
  clearRefreshTimer();
  if (subscribers.size === 0 || read().code === "USD" || fetching) return;
  const table = readFx();
  const dueAt = Math.max(table ? table.fetchedAt + FX_MAX_AGE_MS : 0, retryAt);
  const delay = dueAt - Date.now();
  if (delay > 0) {
    refreshTimer = setTimeout(refreshRates, delay);
    return;
  }
  fetching = true;
  void fetchFxRates()
    .then((result) => {
      if (!result) {
        retryAt = Date.now() + FX_RETRY_MS;
        return;
      }
      fx = { fetchedAt: Date.now(), date: result.date, rates: result.rates };
      retryAt = 0;
      try {
        localStorage.setItem(FX_KEY, JSON.stringify(fx));
      } catch {
        // The in-memory table still applies when persistence is unavailable.
      }
      invalidate();
    })
    .catch(() => {
      retryAt = Date.now() + FX_RETRY_MS;
    })
    .finally(() => {
      fetching = false;
      refreshRates();
    });
}

function invalidate() {
  snapshot = null;
  subscribers.forEach((onChange) => onChange());
  refreshRates();
}

function read(): CurrencyState {
  if (!snapshot) snapshot = compute();
  return snapshot;
}

function readServer(): CurrencyState {
  return SERVER;
}

function onStorage(e: StorageEvent) {
  if (e.key !== PREF_KEY && e.key !== FX_KEY && e.key !== null) return;
  if (e.key === PREF_KEY || e.key === null) {
    preference = isCurrency(e.newValue) ? e.newValue : null;
  }
  if (e.key === FX_KEY || e.key === null) fx = parseFx(e.newValue);
  invalidate();
}

function subscribe(onChange: () => void) {
  subscribers.add(onChange);
  if (subscribers.size === 1) {
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshRates);
    window.addEventListener("online", refreshRates);
    window.addEventListener("languagechange", invalidate);
  }
  refreshRates();
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0) {
      clearRefreshTimer();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshRates);
      window.removeEventListener("online", refreshRates);
      window.removeEventListener("languagechange", invalidate);
    }
  };
}

/** An explicit choice, or "auto" to go back to what the browser says. */
export function setCurrency(next: Currency | "auto") {
  preference = next === "auto" ? null : next;
  try {
    if (next === "auto") localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, next);
  } catch {
    // Private mode: the choice still applies for this page.
  }
  trackEvent(`currency chosen: ${next}`);
  invalidate();
}

export function useCurrency(): CurrencyState {
  return useSyncExternalStore(subscribe, read, readServer);
}

/**
 * The site's money formatter, in the visitor's currency.
 *
 * Takes dollars — every caller already has dollars — and returns the figure
 * as the visitor should read it. Components call this in place of the plain
 * `usd()` helper, which is the same function fixed at dollars: shadowing the
 * name inside a component is deliberate, so a call site reads the same
 * whether or not it has been made currency-aware, and the difference is one
 * line at the top of the component.
 */
export function useFiat(): (usd: number) => string {
  const { code, rate } = useFxRate();
  const locale = useNumberLocale();
  return useCallback((usd: number) => fiat(usd * rate, code, locale), [code, rate, locale]);
}

/** The currency and rate a figure is actually shown in right now: the
 *  visitor's currency once its rate is known, dollars until then. Labels
 *  that name the currency read this, so they never say "JPY" over a figure
 *  that is still in dollars. */
export function useFxRate(): { code: Currency; rate: number } {
  const { code, rate } = useCurrency();
  return rate === null ? { code: "USD", rate: 1 } : { code, rate };
}
