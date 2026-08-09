"use client";

import { useSyncExternalStore } from "react";

/**
 * Site-wide preference for how amounts are denominated: in the units the
 * chain actually moves (XCP), or converted to dollars. Persisted so the
 * choice survives navigation, and shared through an external store rather
 * than context so any component can read it without a provider — and
 * without a load-in-effect, which the react-hooks lint rules reject.
 */
export type Denomination = "XCP" | "USD";

const KEY = "xcpfun:denomination:v1";
const EVENT = "xcpfun:denomination";

let cache: Denomination | null = null;

function read(): Denomination {
  if (cache) return cache;
  try {
    cache = localStorage.getItem(KEY) === "USD" ? "USD" : "XCP";
  } catch {
    cache = "XCP";
  }
  return cache;
}

/** The server has no preference to read; it always renders chain units. */
function readServer(): Denomination {
  return "XCP";
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
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

export function setDenomination(next: Denomination) {
  cache = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode: the choice still applies for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useDenomination() {
  return useSyncExternalStore(subscribe, read, readServer);
}
