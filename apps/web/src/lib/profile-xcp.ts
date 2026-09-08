import type { MintRecord } from "@/lib/api/launchpad-api";

/** Only confirmed contributions still in escrow; refunds and settled mints
 * are no longer committed cash. Unknown or malformed data is never zero. */
export function committedXcp(mints: readonly MintRecord[] | null | undefined): bigint | null {
  if (!mints) return null;
  let total = 0n;
  for (const mint of mints) {
    if (mint.phase !== "minting") continue;
    if (!/^\d+$/.test(mint.paid)) return null;
    total += BigInt(mint.paid);
  }
  return total;
}
