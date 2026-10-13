/**
 * Who may post: a wallet holding at least 10 XCP.
 *
 * Signing in is free, so a ban or a per-author cooldown only binds an
 * identity that costs something to replace. Holding is the bar, not paying:
 * nothing is spent, and XCP paid into a launch that is still minting counts,
 * because it is escrowed rather than gone and minting is exactly what a
 * participant should not lose chat for.
 *
 * Server-only. The verdict is cached per isolate: a holder keeps it for ten
 * minutes, so moving the same 10 XCP between wallets unlocks them slowly; a
 * wallet under the bar is re-read after a minute, so a top-up is noticed soon
 * after it confirms.
 */
import { fetchAssetBalanceOrThrow } from "@/lib/api/counterparty";
import { fetchMintingXcpPaid } from "@/lib/api/launchpad-api";

/** 10 XCP in raw satoshi units. */
export const CHAT_MIN_XCP_RAW = 1_000_000_000n;
const HOLDS_TTL_MS = 10 * 60_000;
const SHORT_TTL_MS = 60_000;
const MAX_ENTRIES = 2_000;

const verdicts = new Map<string, { holds: boolean; at: number }>();

/** Throws when either read fails, so "unknown" never reads as "under 10". */
export async function holdsChatMinimum(address: string, now = Date.now()): Promise<boolean> {
  const cached = verdicts.get(address);
  if (cached && now - cached.at < (cached.holds ? HOLDS_TTL_MS : SHORT_TTL_MS)) return cached.holds;
  const [free, minting] = await Promise.all([
    fetchAssetBalanceOrThrow(address, "XCP"),
    fetchMintingXcpPaid(address),
  ]);
  const holds = free + minting >= CHAT_MIN_XCP_RAW;
  verdicts.delete(address);
  verdicts.set(address, { holds, at: now });
  // Oldest first in insertion order, so this drops the stalest verdict.
  if (verdicts.size > MAX_ENTRIES) verdicts.delete(verdicts.keys().next().value!);
  return holds;
}
