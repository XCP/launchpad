/**
 * The shapes the homepage renders, and the one place an API row becomes one.
 *
 * This exists because rows now arrive by two routes — server-rendered for the
 * first page of a section, fetched in the browser for every page after it —
 * and a row that came back from a click has to be indistinguishable from one
 * that came with the document. Deriving the numbers in two places is how the
 * two quietly stop agreeing, so the derivation lives here and both callers
 * import it.
 */
import type { SearchIndexEntry } from "@/lib/api/launchpad-api";
import type { Fairminter, LaunchPhase } from "@/lib/xcp69";
import { saleProgress } from "@/lib/xcp69";
import { fromSats } from "@/lib/format";
import { big, ratio } from "@/lib/numeric";

/** One launch, with the derived numbers a section needs to tabulate it. */
export interface SectionRow {
  fm: Fairminter;
  phase: LaunchPhase;
  conforming: boolean;
  /** XCP per whole token × supply. Zero until a pool exists. */
  marketCapXcp: number;
  /** XCP per whole token. Zero until a pool exists. */
  priceXcp: number;
  /** Distinct addresses that have minted; null when nothing could count
   *  them. Not zero — zero is the answer for a launch nobody has minted. */
  minters: number | null;
  /** Current positive-balance holders. Only graduated rows request this live
   *  Explorer figure; null means it has not been read yet. */
  holders: number | null;
  /** Block it was announced in; 0 when unresolved. */
  announceBlock: number;
  /** 0–1 toward the soft cap. */
  progress: number;
  /** Block of its most recent mint; null if it has never minted, or if this
   *  row came from a path that cannot answer it. Only the crowned row uses
   *  it, to say how long ago that was. */
  lastMintBlock: number | null;
  /** Creator prose for the graduated card, already mirrored into D1. */
  displayDescription: string | null;
}

/**
 * A launch as either source describes it: `IndexedLaunch` off the API, or the
 * same shape derived live from Counterparty when the API is unreachable.
 *
 * Structural rather than the API's own type, so the fallback path is not
 * forced to fake a `conforming: true` literal or an `xcpDepth` this doesn't
 * read. The two paths must produce identical rows; sharing the input type is
 * how that stays true.
 */
export interface RowSource {
  fm: Fairminter;
  phase: LaunchPhase;
  conforming: boolean;
  poolXcpReserve: string | null;
  poolTokenReserve: string | null;
  announceBlock: number | null;
  minters: number | null;
  /** Optional: the live-derivation path in page.tsx cannot answer it. */
  lastMintBlock?: number | null;
  /** Optional because the launch index tracks minters, not current owners. */
  holders?: number | null;
  /** Optional on the live Counterparty fallback and older API workers. */
  displayDescription?: string | null;
}

/**
 * An indexed launch, with its display numbers worked out.
 *
 * Price is the pool's own ratio; supply is fixed by the standard, so market
 * cap is that price across the whole hard cap.
 */
export function toSectionRow(p: RowSource): SectionRow {
  const xcpReserve = big(p.poolXcpReserve ?? 0);
  const tokenReserve = big(p.poolTokenReserve ?? 0);
  const priceXcp = tokenReserve > 0n ? ratio(xcpReserve, tokenReserve) : 0;
  return {
    fm: p.fm,
    phase: p.phase,
    conforming: p.conforming,
    priceXcp,
    marketCapXcp: priceXcp * fromSats(p.fm.hard_cap),
    // Passed through, null and all. Coalescing to 0 here is exactly the bug
    // this used to have: an unknown count printed as a confident zero.
    minters: p.minters,
    holders: p.holders ?? null,
    announceBlock: p.announceBlock ?? 0,
    progress: saleProgress(p.fm),
    // Undefined on the live-derivation path, which has no index to ask.
    lastMintBlock: p.lastMintBlock ?? null,
    displayDescription: p.displayDescription?.trim() || null,
  };
}

/** One launch, flattened to what search needs to rank and describe it. */
export interface SearchRow {
  asset: string;
  /** Only when it differs from the asset name — a subasset's longname. */
  name: string | null;
  phase: "scheduled" | "minting" | "graduated" | "refunded";
  /** Who opened it. */
  source: string;
  /** Block it was announced in; its real age. */
  announceBlock: number;
  /** Distinct addresses that have minted — the number every phase has. */
  minters: number;
  /** XCP per whole token × supply. Zero unless graduated. */
  marketCapXcp: number;
  /** 0–1 toward the soft cap. Meaningful while minting. */
  progress: number;
  /** When minting opens. Meaningful while scheduled. */
  startBlock: number;
}

/**
 * A compact search-index row, with the same two numbers worked out.
 *
 * The arithmetic deliberately matches {@link toSectionRow} rather than being
 * shared with it: this side gets twelve columns off /v2/launches/index, not a
 * whole Fairminter, so there is no record to hand to `saleProgress`. The
 * fallback from soft cap to hard cap restates `saleTarget` for that reason —
 * if the standard's target ever stops being the soft cap, both have to move.
 */
export function toSearchRow(e: SearchIndexEntry): SearchRow {
  const xcpReserve = big(e.pool_xcp_reserve ?? 0);
  const tokenReserve = big(e.pool_token_reserve ?? 0);
  const priceXcp = tokenReserve > 0n ? ratio(xcpReserve, tokenReserve) : 0;
  const target = big(e.soft_cap) > 0n ? e.soft_cap : e.hard_cap;
  return {
    asset: e.asset,
    // Only when it says something the asset name doesn't.
    name: e.asset_longname && e.asset_longname !== e.asset ? e.asset_longname : null,
    phase: e.phase as SearchRow["phase"],
    source: e.source,
    announceBlock: e.announce_block ?? 0,
    minters: e.minters,
    marketCapXcp: priceXcp * fromSats(e.hard_cap),
    progress: ratio(e.earned_quantity, target),
    startBlock: e.start_block,
  };
}

/** A section's row set as one value: the page, and how long the whole list is.
 *  Kept together because the pager is only correct when it reads both from the
 *  same answer. */
export interface LaunchPage {
  rows: SectionRow[];
  total: number;
  /** The launch reigning over this phase — most recently minted, out of
   *  everything still minting. Null everywhere else, and null on the live
   *  fallback, which has no way to ask the question. */
  king: SectionRow | null;
}

/**
 * How many a section shows before paging, by phase.
 *
 * Not one number: these sections answer different questions. Graduated is a
 * shortlist of what did well, so eight is a look rather than a catalogue.
 * Minting is the one people are actually shopping, so it gets the most room —
 * enough that the whole phase usually fits on one page and the pager is there
 * for the times it doesn't, rather than being the normal way to see the list.
 *
 * 8 divides evenly by 2, 3 and 4 — the grid's column counts — so graduated
 * never ends on a ragged half-row. 40 and 20 don't divide by 3, so at the md
 * breakpoint a FULL page of either ends short. It only shows once a phase
 * actually reaches its page size; 36/48 and 18/24 are the neighbours that keep
 * all three breakpoints clean if it starts to look wrong.
 *
 * It lives here rather than in launch-sections.tsx because it is now a LIMIT
 * as well as a layout: the server renders the first page and the browser
 * fetches the rest, and if those two used different numbers the first click of
 * the pager would skip or repeat rows. The API caps `limit` at 100, so this
 * has room to grow but not unboundedly.
 */
export const PER_PAGE: Record<LaunchPhase, number> = {
  graduated: 8,
  minting: 40,
  scheduled: 20,
  refunded: 20,
};
