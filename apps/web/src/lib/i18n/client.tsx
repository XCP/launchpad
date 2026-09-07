"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale, localePath } from "@/lib/i18n/locales";
import { makeT, type Messages, type T } from "@/lib/i18n/t";

interface LocaleContextValue {
  locale: Locale;
  t: T;
  /** Most of this locale is still the model's draft — the footer says so. */
  machine: boolean;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: makeT({}),
  machine: false,
});

/**
 * Hands the current locale and its messages to client components.
 *
 * Rendered once by the locale layout with only the CURRENT locale's map, so
 * the client never carries a language it is not showing. English carries an
 * empty map: every `t` call falls through to its own source text.
 */
export function LocaleProvider({
  locale,
  messages,
  machine = false,
  children,
}: {
  locale: Locale;
  messages: Messages;
  machine?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: makeT(messages), machine }),
    [locale, messages, machine],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useMachineDrafted(): boolean {
  return useContext(LocaleContext).machine;
}

/** The translation function for the current locale. */
export function useT(): T {
  return useContext(LocaleContext).t;
}

/** `/faq` as this locale would link to it: `/ja/faq` in Japanese. */
export function useLocalePath(): (path: string) => string {
  const locale = useLocale();
  return (path: string) => localePath(locale, path);
}
