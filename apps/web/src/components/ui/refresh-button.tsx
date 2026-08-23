"use client";

import { useEffect, useState } from "react";
import { FOCUS } from "@/components/ui/tokens";

/** Smashable without hammering the API: the button always responds, but a
 *  second fetch inside this window is refused rather than queued. */
const MANUAL_REFRESH_DEBOUNCE_MS = 10_000;

/**
 * Refresh, wearing the settings-gear's clothes: the same quiet icon button in
 * the same corner the swap tabs keep theirs, so a live page reads as familiar
 * UI rather than growing its own freshness strip. No age readout anywhere —
 * the auto-poll keeps the page current, and the button is for impatience.
 *
 * Lives here rather than beside one page because /mempool and /activity are
 * the same idea at two time horizons and should not drift apart: two copies of
 * a cooldown is two chances for one of them to become a different number.
 */
export function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [lastManual, setLastManual] = useState(0);

  // The timer exists so the cooldown visibly ends — without it nothing
  // re-renders the button back to life.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const cooling = now - lastManual < MANUAL_REFRESH_DEBOUNCE_MS;

  return (
    <button
      type="button"
      onClick={() => {
        if (cooling) return;
        setLastManual(Date.now());
        onRefresh();
      }}
      aria-disabled={cooling}
      aria-label="Refresh"
      className={`flex size-7 items-center justify-center rounded-full transition-colors ${FOCUS} ${
        cooling
          ? "cursor-default text-gray-300"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      }`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
        <path
          fillRule="evenodd"
          d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
