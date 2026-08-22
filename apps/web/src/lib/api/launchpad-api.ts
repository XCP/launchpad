/**
 * Reads the index from launchpad-api's D1 mirror instead of deriving it from
 * a few-hundred-row Counterparty fan-out on every request. Any failure —
 * timeout, non-200, an empty or malformed body — returns null, and the
 * caller falls back to the live derivation. The API is a cache with
 * provenance, not a new source of truth: nothing here is the only place a
 * fact lives.
 */
import type { Fairminter, LaunchPhase } from "@/lib/xcp69";
import type { MempoolMint } from "@/lib/api/counterparty";
import type { MempoolOrder } from "@launchpad/xcp69/mempool";

/**
 * The custom domain, for the same reason next.config.ts 308s every
 * workers.dev URL to xcp.fun: one canonical origin. api.xcp.fun is the
 * documented public API and the host that appears in docs and examples, so it
 * should be the host the site itself calls.
 *
 * NOT for a caching reason, despite the folklore. The Cache API is widely
 * described as a no-op on workers.dev subdomains; measured against this
 * worker on a fresh cache key it is not — both hosts returned
 * cf-cache-status: HIT identically. The edge cache in apps/api's read router
 * works on either. If that ever changes, this comment is the place that was
 * checked.
 *
 * workers.dev stays enabled regardless: the LaunchRoom and SitePresence
 * sockets still connect there, and a WebSocket has nothing to cache.
 */
const API_BASE = process.env.NEXT_PUBLIC_LAUNCHPAD_API_BASE ?? "https://api.xcp.fun";

interface ApiLaunchRow {
  tx_hash: string;
  tx_index: number;
  asset: string;
  asset_longname: string | null;
  source: string;
  divisible: number;
  start_block: number;
  end_block: number;
  price: string;
  quantity_by_price: string;
  hard_cap: string;
  soft_cap: string;
  pool_quantity: string | null;
  max_mint_per_tx: string;
  max_mint_per_address: string | null;
  premint_quantity: string;
  minted_asset_commission_int: string | null;
  burn_payment: number;
  lock_quantity: number;
  lock_description: number;
  lp_asset: string | null;
  description: string | null;
  status: string;
  phase: LaunchPhase;
  earned_quantity: string | null;
  paid_quantity: string | null;
  current_deadline_block: number;
  pool_xcp_sats: number;
  pool_xcp_reserve: string | null;
  pool_token_reserve: string | null;
  announce_block: number | null;
  minters: number;
  /** Optional because a worker older than migration 0012 does not send it. */
  last_mint_block?: number | null;
  /** Optional during the API/web rolling deploy. */
  display_description?: string | null;
}

export interface IndexedLaunch {
  fm: Fairminter;
  phase: LaunchPhase;
  conforming: true; // the API only ever stores rows that passed the verdict
  xcpDepth: bigint;
  /** Live pool reserves. Their ratio is XCP sats per raw token unit, which
   *  prices a holding without a per-asset pool lookup. */
  poolXcpReserve: string | null;
  poolTokenReserve: string | null;
  /** The block the launch was ANNOUNCED in — its real age. `fm.block_index`
   *  is a stand-in for start_block on this path and can't answer that. */
  announceBlock: number | null;
  /** Distinct addresses that have minted. The one participation number every
   *  phase has, which is what makes it the cross-phase column in search. */
  minters: number;
  /** Block of this launch's most recent mint; null if it has never minted.
   *  What the crown is ordered by, and what the badge counts back from. */
  lastMintBlock: number | null;
  /** Creator prose from D1; null until the bounded metadata worklist resolves it. */
  displayDescription: string | null;
}

function toFairminter(row: ApiLaunchRow): Fairminter {
  return {
    tx_hash: row.tx_hash,
    tx_index: row.tx_index,
    // Not stored (only used by the live path to order un-indexed rows);
    // start_block is a harmless stand-in since nothing downstream reads it.
    block_index: row.start_block,
    source: row.source,
    asset: row.asset,
    asset_longname: row.asset_longname,
    description: row.description ?? "",
    price: row.price,
    quantity_by_price: row.quantity_by_price,
    hard_cap: row.hard_cap,
    soft_cap: row.soft_cap,
    soft_cap_deadline_block: row.current_deadline_block,
    start_block: row.start_block,
    end_block: row.end_block,
    burn_payment: Boolean(row.burn_payment),
    max_mint_per_tx: row.max_mint_per_tx,
    max_mint_per_address: row.max_mint_per_address,
    premint_quantity: row.premint_quantity,
    minted_asset_commission_int: row.minted_asset_commission_int,
    lock_description: Boolean(row.lock_description),
    lock_quantity: Boolean(row.lock_quantity),
    divisible: Boolean(row.divisible),
    pool_quantity: row.pool_quantity,
    lp_asset: row.lp_asset,
    status: row.status,
    earned_quantity: row.earned_quantity,
    paid_quantity: row.paid_quantity,
  };
}

export interface FeeSummary {
  totalFeeSats: number;
  counted: number;
  mints: number;
}

interface ApiFeeSummary {
  total_fee_sats: number;
  counted: number;
  mints: number;
}

/** Bitcoin-side fee total for a launch's mints — data only apps/api has
 *  (fetched server-side from mempool.space, once per mint, ever); the live
 *  Counterparty derivation has no equivalent to fall back to, so a failure
 *  here just hides the stat. */
export async function fetchLaunchFees(asset: string): Promise<FeeSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches/${asset}/fees`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiFeeSummary | null };
    if (!data.result) return null;
    return {
      totalFeeSats: data.result.total_fee_sats,
      counted: data.result.counted,
      mints: data.result.mints,
    };
  } catch {
    return null;
  }
}

export interface MempoolSnapshot {
  fairminters: Fairminter[];
  mints: MempoolMint[];
  orders: MempoolOrder[];
  /** Server-side fetch time, seconds. The client turns it into "updated Ns
   *  ago", and it comes from the response rather than from arrival so every
   *  tab sharing one cached answer agrees on its age. */
  fetchedAt: number;
}

/**
 * The mempool, already filtered to XCP-69.
 *
 * This used to be two Counterparty requests plus a launch-index download, run
 * independently by every open tab — the header chip carries the poll and the
 * header is on every page. Behind the API's edge cache it is one request, and
 * a thousand tabs collapse into roughly one Counterparty call per colo.
 *
 * Returns null on any failure so the caller can hold its last good answer
 * rather than blink the chip out over one bad request.
 */
export async function fetchMempoolSnapshot(): Promise<MempoolSnapshot | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/mempool`, {
      signal: AbortSignal.timeout(6_000),
      // A polled endpoint must never be answered by the browser's own cache:
      // the poll IS the freshness, and a cached reply makes it a timer that
      // reports the same answer forever. Not theoretical here — Cloudflare
      // rewrites `max-age` on anything it serves from its cache to the zone's
      // Browser Cache TTL, so this route asks for 30 seconds and the browser
      // is told four hours.
      //
      // The edge cache is what protects D1, and it is untouched by this: the
      // request still stops at the colo, it just stops being answered from
      // memory in the tab.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: {
        fairminters?: Fairminter[];
        mints?: MempoolMint[];
        orders?: MempoolOrder[];
        fetched_at?: number;
      };
    };
    if (!data.result) return null;
    return {
      fairminters: data.result.fairminters ?? [],
      mints: data.result.mints ?? [],
      orders: data.result.orders ?? [],
      // Seconds on the wire, milliseconds here — the unit changes at this
      // boundary and nowhere else, so callers can treat it like any other
      // Date.now() value. Falls back to arrival time if the field is absent,
      // since "updated Ns ago" reading 1970 is worse than being a moment off.
      fetchedAt: data.result.fetched_at ? data.result.fetched_at * 1000 : Date.now(),
    };
  } catch {
    return null;
  }
}

export interface MyLaunch {
  txHash: string;
  asset: string;
  phase: LaunchPhase;
  status: string;
  conforming: boolean | null;
  announceBlock: number | null;
}

interface ApiMyLaunchRow {
  tx_hash: string;
  asset: string;
  phase: LaunchPhase;
  status: string;
  conforming: number | null;
  announce_block: number | null;
}

/** A connected wallet's own launches — unfiltered by conformance verdict,
 *  since this is the creator's own view, not the public index. */
export async function fetchLaunchesBySource(source: string): Promise<MyLaunch[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches/by/${encodeURIComponent(source)}`, {
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiMyLaunchRow[] };
    if (!Array.isArray(data.result)) return null;
    return data.result.map((row) => ({
      txHash: row.tx_hash,
      asset: row.asset,
      phase: row.phase,
      status: row.status,
      conforming: row.conforming === null ? null : Boolean(row.conforming),
      announceBlock: row.announce_block,
    }));
  } catch {
    return null;
  }
}

export interface MintRecord {
  txHash: string;
  asset: string;
  phase: LaunchPhase;
  divisible: boolean;
  block: number;
  earned: string;
  paid: string;
}

interface ApiMintRow {
  tx_hash: string;
  asset: string;
  phase: LaunchPhase;
  divisible: number;
  block_index: number;
  earn_quantity: string;
  paid_quantity: string;
}

/** An address's mints across every launch. Only apps/api can answer this —
 *  the on-chain ledger records a mint's XCP leg without naming the asset. */
export async function fetchMintsBySource(source: string): Promise<MintRecord[] | null> {
  try {
    const rows: ApiMintRow[] = [];
    let offset = 0;
    do {
      const res = await fetch(
        `${API_BASE}/v2/mints/by/${encodeURIComponent(source)}?limit=1000&offset=${offset}`,
        { signal: AbortSignal.timeout(3_000), cache: "no-store" },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { result?: ApiMintRow[]; next_offset?: number | null };
      if (!Array.isArray(data.result)) return null;
      rows.push(...data.result);
      if (data.next_offset === null || data.next_offset === undefined) break;
      offset = data.next_offset;
    } while (offset <= 100_000);
    return rows.map((r) => ({
      txHash: r.tx_hash,
      asset: r.asset,
      phase: r.phase,
      divisible: Boolean(r.divisible),
      block: r.block_index,
      earned: r.earn_quantity,
      paid: r.paid_quantity,
    }));
  } catch {
    return null;
  }
}

export interface AssetEvent {
  event: string;
  asset: string;
  block: number;
  tokenDelta: string;
  xcpDelta: string;
  kind: string;
}

interface ApiEventRow {
  event: string;
  asset: string;
  block_index: number;
  token_delta: string;
  xcp_delta: string;
  kind: string;
}

/** An address's trades on XCP-69 assets, from the indexer. One request,
 *  answered by an index — the browser no longer walks the whole ledger. */
export async function fetchEventsBySource(source: string): Promise<AssetEvent[] | null> {
  try {
    const rows: ApiEventRow[] = [];
    let offset = 0;
    do {
      const res = await fetch(
        `${API_BASE}/v2/events/by/${encodeURIComponent(source)}?limit=2000&offset=${offset}`,
        { signal: AbortSignal.timeout(3_000), cache: "no-store" },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { result?: ApiEventRow[]; next_offset?: number | null };
      if (!Array.isArray(data.result)) return null;
      rows.push(...data.result);
      if (data.next_offset === null || data.next_offset === undefined) break;
      offset = data.next_offset;
    } while (offset <= 100_000);
    return rows.map((r) => ({
      event: r.event,
      asset: r.asset,
      block: r.block_index,
      tokenDelta: r.token_delta,
      xcpDelta: r.xcp_delta,
      kind: r.kind,
    }));
  } catch {
    return null;
  }
}

export interface LaunchpadAddressSummary {
  mints: {
    transactions: number;
    launches: number;
    paid_xcp: string;
  };
  market: {
    fills: number;
    assets: number;
    bought_xcp: string;
    sold_xcp: string;
  };
  asset: {
    mints: number;
    buys: number;
    sells: number;
    /** Optional during a rolling deploy while an older edge response expires. */
    minted_xcp?: string;
    bought_xcp: string;
    sold_xcp: string;
    tracked: {
      quantity: string;
      cost_xcp: string;
      realized_pnl_xcp: string;
      complete: boolean;
    };
  };
}

/** One hover-gated request over xcp.fun indexes; no explorer fan-out. */
export async function fetchLaunchpadAddressSummary(
  source: string,
  asset: string,
): Promise<LaunchpadAddressSummary | null> {
  try {
    const res = await fetch(
      `${API_BASE}/v2/addresses/${encodeURIComponent(source)}/summary?asset=${encodeURIComponent(asset)}`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: LaunchpadAddressSummary };
    return data.result ?? null;
  } catch {
    return null;
  }
}

function toIndexedLaunch(row: ApiLaunchRow): IndexedLaunch {
  return {
    fm: toFairminter(row),
    phase: row.phase,
    conforming: true as const,
    xcpDepth: BigInt(Math.trunc(row.pool_xcp_sats) || 0),
    poolXcpReserve: row.pool_xcp_reserve,
    poolTokenReserve: row.pool_token_reserve,
    announceBlock: row.announce_block,
    minters: row.minters,
    lastMintBlock: row.last_mint_block ?? null,
    displayDescription: row.display_description?.trim() || null,
  };
}

/** One indexed launch, including its full mirrored creator description. */
export async function fetchIndexedLaunch(asset: string): Promise<IndexedLaunch | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches/${encodeURIComponent(asset)}`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiLaunchRow | null };
    return data.result ? toIndexedLaunch(data.result) : null;
  } catch {
    return null;
  }
}

/** Every phase's top `perPhase` in one response — a universe to price a
 *  holding against, not a list to read. The homepage pages with
 *  {@link fetchLaunchPage} instead; this is what the profile and portfolio
 *  views ask for when they need every launch they might hold. */
export async function fetchIndexedLaunches(
  perPhase: number,
): Promise<IndexedLaunch[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches?per_phase=${perPhase}`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiLaunchRow[] };
    if (!Array.isArray(data.result)) return null;
    return data.result.map(toIndexedLaunch);
  } catch {
    return null;
  }
}

/** One page of one phase, and how many that phase holds in total. */
export interface IndexedPage {
  rows: IndexedLaunch[];
  total: number;
  /**
   * The launch that minted most recently, out of everything still minting.
   *
   * Comes from the worker rather than being picked out of `rows`, because it
   * is a fact about the phase and `rows` is one page of it — the reigning
   * launch is usually NOT on the page being shown. Null on every phase but
   * minting, null before anything has minted, and null from a worker too old
   * to know the field.
   */
  king: IndexedLaunch | null;
}

/**
 * Ordinary offset/limit paging over one phase.
 *
 * Called from the server for a section's first page and from the browser for
 * every page after it, so it takes no Next-specific fetch options — the edge
 * cache in front of the worker is what makes it cheap in both places, and a
 * `next.revalidate` hint would be ignored in a browser anyway.
 *
 * `total` counts the phase, not the page. It travels with the rows because a
 * pager that gets its length from somewhere else is a pager that can disagree
 * with the list it sits under — which is exactly the bug this replaced, where
 * the heading counted the table via /v2/stats and the pager divided a
 * fixed-size prefetch that had already clipped the phase.
 *
 * Null on any failure, like every other reader here: the caller keeps whatever
 * it was already showing rather than blanking a section over one bad request.
 */
export async function fetchLaunchPage(
  phase: LaunchPhase,
  /** Omit for the phase's default ordering. Left out rather than spelled out
   *  so the default has exactly one definition — DEFAULT_SORT in
   *  apps/api/src/queries/launches.ts — instead of a copy on this side that
   *  could quietly disagree with it. */
  sort: string | undefined,
  limit: number,
  offset: number,
  /** When present, exclude launches this address has already minted. The
   *  worker applies it before LIMIT so totals and paging remain truthful. */
  unmintedBy?: string,
): Promise<IndexedPage | null> {
  try {
    const qs =
      `phase=${phase}&limit=${limit}&offset=${offset}` +
      (sort ? `&sort=${encodeURIComponent(sort)}` : "") +
      (unmintedBy ? `&unminted_by=${encodeURIComponent(unmintedBy)}` : "");
    const res = await fetch(`${API_BASE}/v2/launches?${qs}`, {
      signal: AbortSignal.timeout(6_000),
      // See fetchMempoolSnapshot: this is the other polled route, and the
      // section refresh is only a refresh if the browser actually asks.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: ApiLaunchRow[];
      total?: number;
      king?: ApiLaunchRow | null;
    };
    if (!Array.isArray(data.result)) return null;
    // A response without `total` is not a page — it is an OLDER WORKER, which
    // ignores `phase` entirely and answers the per_phase query instead: every
    // phase mixed together, twelve rows, no count. Rendering that into a
    // single phase's section would fill all three sections with the same
    // twelve launches. Treating it as a failure sends the caller to its live
    // Counterparty derivation, which is correct if slower, and means the two
    // deploys can land in either order without a window of wrong pages.
    if (typeof data.total !== "number") return null;
    return {
      rows: data.result.map(toIndexedLaunch),
      total: data.total,
      // Absent rather than null on a worker that predates the crown, which is
      // the same thing to every reader of this: no one is reigning.
      king: data.king ? toIndexedLaunch(data.king) : null,
    };
  } catch {
    return null;
  }
}

/** The twelve columns /v2/launches/index returns, raw. Quantities stay
 *  strings: this side owns the arithmetic (see toSearchRow), and a float
 *  computed on the server would be a second implementation of it. */
export interface SearchIndexEntry {
  asset: string;
  asset_longname: string | null;
  source: string;
  phase: string;
  announce_block: number | null;
  start_block: number;
  minters: number;
  earned_quantity: string | null;
  soft_cap: string;
  hard_cap: string;
  pool_xcp_reserve: string | null;
  pool_token_reserve: string | null;
}

/**
 * Every conforming launch, for search.
 *
 * Unpaged on purpose. Search is a membership question — someone typing an
 * exact ticker has said what they want — and answering "no such launch"
 * because it fell outside a window is a worse failure than a short list.
 *
 * Fetched when the search dialog first opens rather than with the page, so a
 * visit that never searches never pays for it.
 */
export async function fetchSearchIndex(): Promise<SearchIndexEntry[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches/index`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: SearchIndexEntry[] };
    return Array.isArray(data.result) ? data.result : null;
  } catch {
    return null;
  }
}

interface ApiCandleRow {
  bucket_start: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_xcp: string;
  trades: number;
  last_block: number;
}

/** One OHLCV bucket, prices already divided down to XCP per whole token. */
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeXcpRaw: string;
  trades: number;
  lastBlock: number;
}

/**
 * The folded price series for a pair.
 *
 * Returns null — not an empty array — on any failure OR when the table has
 * nothing yet, because those are the same situation from the caller's side:
 * the API is a cache with provenance, and the caller still has the live
 * Counterparty derivation to fall back to. An empty array would claim
 * authoritatively that this pair has never traded.
 *
 * The prices come back scaled by the `scale` the API reports rather than a
 * constant copied to this side, so the two can never drift apart.
 */
export async function fetchCandles(
  asset: string,
  resolution: "1h" | "1d",
  limit = 500,
): Promise<ChartCandle[] | null> {
  try {
    const res = await fetch(
      `${API_BASE}/v2/candles/${encodeURIComponent(asset)}?resolution=${resolution}&limit=${limit}`,
      { signal: AbortSignal.timeout(3_000), next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: ApiCandleRow[];
      scale?: string;
    };
    if (!data.result || data.result.length === 0) return null;
    const scale = Number(data.scale ?? "100000000");
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return data.result.map((r) => ({
      time: r.bucket_start,
      open: Number(r.open) / scale,
      high: Number(r.high) / scale,
      low: Number(r.low) / scale,
      close: Number(r.close) / scale,
      volumeXcpRaw: r.volume_xcp,
      trades: r.trades,
      lastBlock: r.last_block,
    }));
  } catch {
    return null;
  }
}

export interface LaunchStats {
  counts: { scheduled: number; minting: number; graduated: number; refunded: number };
  total: number;
  activity: {
    mints: number;
    minters: number;
    /** XCP satoshi paid into every conforming launch, ever. */
    paid_xcp: number;
    /** XCP satoshi currently committed to launches still minting. */
    active_xcp: number;
    /** Bitcoin satoshi spent on mint transaction fees. */
    fee_sats: number;
    /** Mints whose Bitcoin fee has been indexed. */
    fee_samples?: number;
    /** Median observed Bitcoin fee per mint transaction. */
    median_fee_sats?: number;
  };
  markets?: {
    /** XCP satoshi currently held across graduated pools. */
    pool_xcp: number;
    /** Current combined graduated market cap, in XCP satoshi. */
    market_cap_xcp: number;
  };
  /** Mints per ~144-block bucket; `bucket` is `block_index / 144`. */
  daily: { bucket: number; n: number; minters: number }[];
  /** Refunded launch closures per ~144-block bucket. */
  refunds_daily: { bucket: number; n: number; xcp: number }[];
  blocks_per_bucket: number;
}

/** How many conforming launches sit in each phase. Null on any failure — the
 *  homepage shows section counts when it has them and simply omits them when
 *  it doesn't, rather than rendering a confident zero. */
export async function fetchLaunchStats(height = 0): Promise<LaunchStats | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/stats?height=${height}`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: LaunchStats };
    return data.result ?? null;
  } catch {
    return null;
  }
}

export interface MinterEarning {
  source: string;
  mints: number;
  launches: number;
  /** Raw XCP satoshi committed. */
  paid: string;
}

interface ApiMinterRow {
  source: string;
  mints: number;
  launches: number;
  paid: string;
}

/** The rewards leaderboard — who has minted, most first. Counted per mint
 *  TRANSACTION, the unit the reward is actually paid in. */
export async function fetchMinterEarnings(
  limit = 25,
  source?: string,
  offset = 0,
): Promise<MinterEarning[]> {
  try {
    const qs = `limit=${limit}${offset > 0 ? `&offset=${offset}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
    const res = await fetch(`${API_BASE}/v2/minters?${qs}`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { result?: ApiMinterRow[] };
    if (!Array.isArray(data.result)) return [];
    return data.result.map((r) => ({
      source: r.source,
      mints: r.mints,
      launches: r.launches,
      paid: r.paid,
    }));
  } catch {
    return [];
  }
}

export type RewardTransactionMethod = "mpma" | "enhanced_send";
export type RewardTransactionStatus = "broadcast" | "confirmed" | "replaced" | "failed";
export type VisibleRewardTransactionStatus = Extract<
  RewardTransactionStatus,
  "broadcast" | "confirmed"
>;

export interface RewardPayout {
  batchId: string;
  asset: string;
  firstMintNumber: number;
  cutoffMintNumber: number;
  mintCount: number;
  quantity: string;
  txHash: string;
  method: RewardTransactionMethod;
  status: VisibleRewardTransactionStatus;
  confirmedBlock: number | null;
}

export interface RewardAccount {
  source: string;
  earnedMints: number;
  launches: number;
  /** Raw XCP committed by eligible mint transactions. */
  committedXcp: string;
  /** Raw MINTS earned over the programme lifetime; never a wallet balance. */
  lifetimeEarnedQuantity: string;
  /** Raw MINTS attached to confirmed reward transactions. */
  paidQuantity: string;
  /** Raw MINTS attached to broadcast, not-yet-confirmed transactions. */
  sentPendingQuantity: string;
  /** Raw MINTS earned but not yet attached to a transaction. */
  awaitingQuantity: string;
  hasRewardTx: boolean;
  payouts: RewardPayout[];
}

interface ApiRewardPayout {
  batch_id: string;
  asset: string;
  first_mint_number: number;
  cutoff_mint_number: number;
  mint_count: number;
  quantity: string;
  tx_hash: string;
  method: RewardTransactionMethod;
  status: VisibleRewardTransactionStatus;
  confirmed_block: number | null;
}

interface ApiRewardAccount {
  source: string;
  earned_mints: number;
  launches: number;
  committed_xcp: string;
  lifetime_earned_quantity: string;
  paid_quantity: string;
  sent_pending_quantity: string;
  awaiting_quantity: string;
  has_reward_tx: boolean;
  payouts: ApiRewardPayout[];
}

/** One address's programme ledger. Null means it has no eligible mints. */
export async function fetchRewardAccount(source: string): Promise<RewardAccount | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/rewards/by/${encodeURIComponent(source)}`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiRewardAccount | null };
    const row = data.result;
    if (!row) return null;
    return {
      source: row.source,
      earnedMints: row.earned_mints,
      launches: row.launches,
      committedXcp: row.committed_xcp,
      lifetimeEarnedQuantity: row.lifetime_earned_quantity,
      paidQuantity: row.paid_quantity,
      sentPendingQuantity: row.sent_pending_quantity,
      awaitingQuantity: row.awaiting_quantity,
      hasRewardTx: row.has_reward_tx,
      payouts: row.payouts.map((p) => ({
        batchId: p.batch_id,
        asset: p.asset,
        firstMintNumber: p.first_mint_number,
        cutoffMintNumber: p.cutoff_mint_number,
        mintCount: p.mint_count,
        quantity: p.quantity,
        txHash: p.tx_hash,
        method: p.method,
        status: p.status,
        confirmedBlock: p.confirmed_block,
      })),
    };
  } catch {
    return null;
  }
}

export interface RewardBatchTransaction {
  txHash: string;
  method: RewardTransactionMethod;
  status: RewardTransactionStatus;
  btcFeeSats: number | null;
  recoverableSats: number | null;
  confirmedBlock: number | null;
}

export interface RewardBatch {
  id: string;
  asset: string;
  firstMintNumber: number;
  cutoffMintNumber: number;
  cutoffBlock: number;
  eligibleMints: number;
  recipientCount: number;
  totalQuantity: string;
  sentRecipientCount: number;
  sentQuantity: string;
  status: "frozen" | "broadcast" | "confirmed" | "failed";
  createdAt: number;
  broadcastAt: number | null;
  confirmedAt: number | null;
  transactions: RewardBatchTransaction[];
}

interface ApiRewardBatch {
  id: string;
  asset: string;
  first_mint_number: number;
  cutoff_mint_number: number;
  cutoff_block: number;
  eligible_mints: number;
  recipient_count: number;
  total_quantity: string;
  sent_recipient_count: number;
  sent_quantity: string;
  status: RewardBatch["status"];
  created_at: number;
  broadcast_at: number | null;
  confirmed_at: number | null;
  transactions: Array<{
    tx_hash: string;
    method: RewardTransactionMethod;
    status: RewardTransactionStatus;
    btc_fee_sats: number | null;
    recoverable_sats: number | null;
    confirmed_block: number | null;
  }>;
}

/** Public distributions; frozen batches without a tx never appear here. */
export async function fetchRewardBatches(): Promise<RewardBatch[]> {
  try {
    const res = await fetch(`${API_BASE}/v2/rewards/batches`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { result?: ApiRewardBatch[] };
    if (!Array.isArray(data.result)) return [];
    return data.result.map((b) => ({
      id: b.id,
      asset: b.asset,
      firstMintNumber: b.first_mint_number,
      cutoffMintNumber: b.cutoff_mint_number,
      cutoffBlock: b.cutoff_block,
      eligibleMints: b.eligible_mints,
      recipientCount: b.recipient_count,
      totalQuantity: b.total_quantity,
      sentRecipientCount: b.sent_recipient_count,
      sentQuantity: b.sent_quantity,
      status: b.status,
      createdAt: b.created_at,
      broadcastAt: b.broadcast_at,
      confirmedAt: b.confirmed_at,
      transactions: b.transactions.map((tx) => ({
        txHash: tx.tx_hash,
        method: tx.method,
        status: tx.status,
        btcFeeSats: tx.btc_fee_sats,
        recoverableSats: tx.recoverable_sats,
        confirmedBlock: tx.confirmed_block,
      })),
    }));
  } catch {
    return [];
  }
}
