"use client";

import { useCallback, useSyncExternalStore } from "react";
import { fetchFxRates } from "@/lib/api/launchpad-api";
import { fiat } from "@/lib/format";

/**
 * Which currency the site's fiat figures are shown in.
 *
 * Every money figure on the site is computed in dollars — XCP times the
 * XCP/USD mark — and stays that way; this decides only how the dollars are
 * shown. A visitor whose browser says it is in Japan sees yen, and can
 * override that in the footer, where every other currency is on offer too.
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

export interface CurrencyState {
  /** What the visitor should see: their choice, or what was detected. */
  code: Currency;
  /** No explicit choice stored; `code` came from the browser's locale. */
  auto: boolean;
  /** What the locale says, whatever was chosen. The footer shows it. */
  detected: Currency;
  /** Units of `code` per dollar. Null until the table has loaded, in which
   *  case figures stay in dollars rather than in a currency at rate 1. */
  rate: number | null;
  /** The ECB day the rate is from; null until loaded or for dollars. */
  date: string | null;
}

const PREF_KEY = "xcpfun:currency:v1";
const FX_KEY = "xcpfun:fx:v1";
const EVENT = "xcpfun:currency";
/** The ECB publishes once a business day; twice a day is plenty. */
const FX_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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
 * What the browser implies, and it only ever implies one thing: Japan.
 *
 * Dollars are the default for everyone, and the one market the site goes
 * out of its way to meet in its own currency is Japan — so detection is a
 * single question with two signals rather than a table of every region.
 * The browser's language says what the visitor configured; `maximize()`
 * fills in the likely region for a bare "ja", so it resolves like "ja-JP".
 * The timezone says where the machine thinks it is. Either is enough: a
 * Japanese speaker abroad and an English-speaking machine in Tokyo both
 * get yen, and both can put it back to dollars in the footer, where every
 * other currency the feed can price is on offer as well.
 */
function detect(): Currency {
  if (typeof navigator === "undefined") return "USD";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    try {
      const locale = new Intl.Locale(tag);
      if (locale.language === "ja" || locale.maximize().region === "JP") return "JPY";
    } catch {
      // Malformed tag: try the next one.
    }
  }
  try {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Tokyo") return "JPY";
  } catch {
    // No timezone available: language was the only signal.
  }
  return "USD";
}

function readPreference(): Currency | null {
  try {
    const stored = localStorage.getItem(PREF_KEY);
    return isCurrency(stored) ? stored : null;
  } catch {
    return null;
  }
}

interface StoredFx {
  fetchedAt: number;
  date: string;
  rates: Record<string, number>;
}

function readFx(): StoredFx | null {
  try {
    const raw = localStorage.getItem(FX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredFx>;
    if (
      typeof parsed.fetchedAt !== "number" ||
      typeof parsed.date !== "string" ||
      typeof parsed.rates !== "object" ||
      parsed.rates === null
    ) {
      return null;
    }
    return parsed as StoredFx;
  } catch {
    return null;
  }
}

let snapshot: CurrencyState | null = null;
let fetching = false;

function compute(): CurrencyState {
  const preference = readPreference();
  const detected = detect();
  const code = preference ?? detected;
  if (code === "USD") return { code, auto: preference === null, detected, rate: 1, date: null };
  const fx = readFx();
  const rate = fx?.rates[code];
  return {
    code,
    auto: preference === null,
    detected,
    rate: typeof rate === "number" && rate > 0 ? rate : null,
    date: fx?.date ?? null,
  };
}

/** Fetch the table when a non-dollar currency has none, or one older than a
 *  trading day. Never for dollars, and never twice for one table: a fresh
 *  table that lacks the chosen code leaves that code in dollars until the
 *  next refresh, rather than refetching on every render — a fetch that
 *  resolves invalidates the snapshot, which re-renders, which would ask
 *  again, forever. */
function ensureRates(state: CurrencyState) {
  if (state.code === "USD" || fetching) return;
  const fx = readFx();
  if (fx && Date.now() - fx.fetchedAt < FX_MAX_AGE_MS) return;
  fetching = true;
  void fetchFxRates()
    .then((result) => {
      if (!result) return;
      try {
        localStorage.setItem(
          FX_KEY,
          JSON.stringify({ fetchedAt: Date.now(), date: result.date, rates: result.rates }),
        );
      } catch {
        // Private mode: the rate still applies for this page via the snapshot.
      }
      invalidate();
    })
    .finally(() => {
      fetching = false;
    });
}

function invalidate() {
  snapshot = null;
  window.dispatchEvent(new Event(EVENT));
}

function read(): CurrencyState {
  if (!snapshot) {
    snapshot = compute();
    ensureRates(snapshot);
  }
  return snapshot;
}

function readServer(): CurrencyState {
  return SERVER;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREF_KEY || e.key === FX_KEY) {
      snapshot = null;
      onChange();
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** An explicit choice, or "auto" to go back to what the browser says. */
export function setCurrency(next: Currency | "auto") {
  try {
    if (next === "auto") localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, next);
  } catch {
    // Private mode: the choice still applies for this page.
  }
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
  return useCallback((usd: number) => fiat(usd * rate, code), [code, rate]);
}

/** The currency and rate a figure is actually shown in right now: the
 *  visitor's currency once its rate is known, dollars until then. Labels
 *  that name the currency read this, so they never say "JPY" over a figure
 *  that is still in dollars. */
export function useFxRate(): { code: Currency; rate: number } {
  const { code, rate } = useCurrency();
  return rate === null ? { code: "USD", rate: 1 } : { code, rate };
}
