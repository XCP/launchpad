import { fetchFairmintersByAsset, fetchOriginalRecord } from "@/lib/api/counterparty";
import { fetchIndexedLaunch, type IndexedLaunch } from "@/lib/api/launchpad-api";
import { xcp69Params, type Fairminter } from "@/lib/xcp69";

export interface AssetLaunch {
  indexed: IndexedLaunch | null;
  fm: Fairminter | null;
  /** A rejected confirmed launch must not fall through to a mempool launch. */
  hasConfirmedFairminters: boolean;
}

/** The indexed detail already carries the fairminter used by the rest of
 *  xcp.fun. Reuse it before asking for the same launch through the protocol
 *  API. Keep the old 30s server cache window; fetchIndexedLaunch bypasses
 *  browser storage and the API caches for 15s. The mirror itself reconciles
 *  every five minutes plus mempool-triggered fast sync, so connected mint
 *  forms use fetchLiveMintFairminter for their transaction-time allowance.
 *  Null from the index is only a fallback signal. A failed fallback throws,
 *  so SWR keeps a valid previous cap instead of replacing it with zero. */
export async function fetchAssetLaunch(
  asset: string,
  { freshStatus = false }: { freshStatus?: boolean } = {},
): Promise<AssetLaunch> {
  const candidate = await fetchIndexedLaunch(asset, 30);
  // An incomplete or mismatched payload is a failed index read, not proof
  // that this asset has a confirmed nonconforming fairminter.
  const indexed = candidate?.fm.asset === asset && candidate.fm.tx_hash ? candidate : null;
  if (indexed) {
    // Indexed block_index is a stand-in for start_block. Pending conformance
    // needs the actual announcement block, just as opened launches do.
    const fm = { ...indexed.fm, block_index: indexed.announceBlock ?? indexed.fm.block_index };
    // Server renders must observe opening, expiry and early sell-out on the
    // existing thirty-second node-read window. An indexed closed launch is
    // final; open/pending rows still need a live status read when requested.
    const needsFreshStatus = freshStatus && fm.status !== "closed";
    if (!needsFreshStatus && (fm.status !== "pending" || indexed.announceBlock !== null)) {
      return { indexed, fm: xcp69Params(fm) ? fm : null, hasConfirmedFairminters: true };
    }
  }
  const fairminters = await fetchFairmintersByAsset(asset);
  const fm = fairminters.find((fm) => xcp69Params(fm)) ?? null;
  return {
    // A newer relaunch can arrive before the index catches up. Do not mix
    // its fairminter with the previous launch's age or burned supply.
    indexed: fm && indexed?.fm.tx_hash === fm.tx_hash ? indexed : null,
    fm,
    hasConfirmedFairminters: indexed !== null || fairminters.length > 0,
  };
}

/** Only immutable indexed evidence can replace the creation-event read.
 *  A closed row's current deadline can be the early sell-out block. */
export async function fetchLaunchOriginal({ indexed, fm }: AssetLaunch) {
  if (!fm || fm.status === "pending" || fm.confirmed === false) {
    return { deadline: null, announceBlock: null };
  }
  if (indexed?.fm.tx_hash === fm.tx_hash && indexed.announceBlock !== null &&
      (fm.status !== "closed" || indexed.originalDeadline !== null)) {
    return { deadline: indexed.originalDeadline, announceBlock: indexed.announceBlock };
  }
  return fetchOriginalRecord(fm.tx_hash);
}
