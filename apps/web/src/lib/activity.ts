/**
 * The activity feed: what this address actually did on xcp.fun.
 *
 * Two indexed sources, one request each. Mints come from apps/api because the
 * chain records a mint's XCP leg as an `escrowed fairmint` debit that names no
 * asset — unattributable from the ledger alone. Trades come from asset_events,
 * where both legs were paired server-side.
 *
 * This deliberately no longer walks the address's raw credit/debit ledger.
 * Doing so cost ~14,000 rows across 17 requests per refresh to surface a
 * handful of XCP-69 rows. The tradeoff is that plain transfers in and out no
 * longer appear; mints, refunds, and market fills — everything that happens
 * ON this site — all do.
 */
import type { MintRecord, AssetEvent } from "@/lib/api/launchpad-api";
import { big } from "@/lib/numeric";

export type ActivityKind =
  | "mint"
  | "mint_pending"
  | "refund"
  | "buy"
  | "sell";

export interface ActivityRow {
  key: string;
  block: number;
  kind: ActivityKind;
  asset: string;
  /** Signed: tokens in is positive. */
  tokenDelta: bigint;
  /** Signed: XCP paid is negative, XCP received positive. */
  xcpDelta: bigint;
  divisible: boolean;
}

export function computeActivity(
  events: AssetEvent[],
  mints: MintRecord[],
  universe: Map<string, boolean>,
): ActivityRow[] {
  const rows: ActivityRow[] = mints.map((m) => ({
    key: `m-${m.txHash}`,
    block: m.block,
    // The launch's own phase says what became of the mint: graduated means
    // the tokens were credited, refunded means the XCP came back, and
    // anything else means it is still escrowed and undecided.
    kind:
      m.phase === "refunded" ? "refund" : m.phase === "graduated" ? "mint" : "mint_pending",
    asset: m.asset,
    tokenDelta: m.phase === "refunded" ? 0n : big(m.earned),
    xcpDelta: m.phase === "refunded" ? big(m.paid) : -big(m.paid),
    divisible: m.divisible,
  }));

  for (const e of events) {
    rows.push({
      key: `e-${e.asset}-${e.block}-${e.tokenDelta}`,
      block: e.block,
      kind: e.kind === "sell" ? "sell" : "buy",
      asset: e.asset,
      tokenDelta: big(e.tokenDelta),
      xcpDelta: big(e.xcpDelta),
      divisible: universe.get(e.asset) ?? true,
    });
  }

  return rows.sort((a, b) => b.block - a.block);
}
