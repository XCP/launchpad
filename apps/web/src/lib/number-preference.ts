"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "@/lib/i18n/client";
import { isNumberLocale, type NumberLocale } from "@/lib/i18n/number-locales";
export { isNumberLocale, type NumberLocale } from "@/lib/i18n/number-locales";

export const NUMBER_PREF_KEY = "xcpfun:number-locale:v1";
const listeners = new Set<() => void>();
let memory: NumberLocale | null | undefined;

function read(): NumberLocale | null {
  if (memory !== undefined) return memory;
  try {
    const saved = localStorage.getItem(NUMBER_PREF_KEY);
    memory = isNumberLocale(saved) ? saved : null;
  } catch { memory = null; }
  return memory;
}
function changed() { for (const listener of listeners) listener(); }
function onStorage(event: StorageEvent) {
  if (event.key === NUMBER_PREF_KEY || event.key === null) {
    memory = undefined;
    changed();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
const readServer = () => null;

export function setNumberLocale(value: NumberLocale | "auto") {
  if (value !== "auto" && !isNumberLocale(value)) return;
  memory = value === "auto" ? null : value;
  try {
    if (memory === null) localStorage.removeItem(NUMBER_PREF_KEY);
    else localStorage.setItem(NUMBER_PREF_KEY, memory);
  } catch { /* The preference still works for this session. */ }
  changed();
}

/** This preference is presentation only. Transaction parsers never read it. */
export function useNumberPreference() {
  const language = useLocale();
  const explicit = useSyncExternalStore(subscribe, read, readServer);
  return { locale: explicit ?? language, auto: explicit === null };
}

export function useNumberLocale(): NumberLocale { return useNumberPreference().locale; }
