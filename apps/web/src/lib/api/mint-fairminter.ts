"use client";

import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { xcp69Params, type Fairminter } from "@/lib/xcp69";

/** A connected mint form needs the current node's cap, not the five-minute
 *  display index. Use the same direct reader as transaction-time balances;
 *  the SDK still performs its authoritative compose validation before signing.
 *  Failures throw so SWR retains a previous live cap instead of replacing it
 *  with an older index snapshot. */
export async function fetchLiveMintFairminter(asset: string): Promise<Fairminter | null> {
  const data = await fetchJson(
    `${COUNTERPARTY_API_BASE}/assets/${encodeURIComponent(asset)}/fairminters?limit=100&verbose=true`,
  );
  if (!Array.isArray(data.result)) throw new Error("Invalid fairminter response");
  return (data.result as Fairminter[]).find((fm) => xcp69Params(fm)) ?? null;
}
