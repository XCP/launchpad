"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * True where the primary pointer can't hover — phones and tablets. Hover
 * previews are unreachable there, so components use this to offer the same
 * content on tap instead.
 *
 * Read through an external store rather than an effect: the server has no
 * pointer to report, so it answers false and the client corrects on
 * hydration.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
