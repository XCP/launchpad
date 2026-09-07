"use client";

import { useMemo } from "react";
import { bindNumbers, type Numbers } from "@/lib/format";
import { useNumberLocale } from "@/lib/number-preference";

export type { Numbers };

/**
 * The number formatters, bound to the locale the page is rendering in.
 *
 * The binding itself lives in lib/format beside the formatters, because a
 * server component has to be able to call it too and a "use client" module
 * cannot be imported from the server. This file is only the hook.
 */
export function useNumbers(): Numbers {
  const locale = useNumberLocale();
  return useMemo(() => bindNumbers(locale), [locale]);
}
