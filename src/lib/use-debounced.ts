"use client";

import { useEffect, useState } from "react";

/**
 * Debounced value (not callback) — compare the return against the input to
 * get a free "is a newer value pending?" flag, and use the debounced value
 * in the SWR key so quoting coalesces keystrokes without extra plumbing.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
