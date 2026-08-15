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
const API_BASE = "https://api.xcp.fun";

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
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: {
        fairminters?: Fairminter[];
        mints?: MempoolMint[];
        fetched_at?: number;
      };
    };
    if (!data.result) return null;
    return {
      fairminters: data.result.fairminters ?? [],
      mints: data.result.mints ?? [],
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
    const res = await fetch(`${API_BASE}/v2/mints/by/${encodeURIComponent(source)}`, {
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiMintRow[] };
    if (!Array.isArray(data.result)) return null;
    return data.result.map((r) => ({
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
  asset: string;
  block: number;
  tokenDelta: string;
  xcpDelta: string;
  kind: string;
}

interface ApiEventRow {
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
    const res = await fetch(`${API_BASE}/v2/events/by/${encodeURIComponent(source)}`, {
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiEventRow[] };
    if (!Array.isArray(data.result)) return null;
    return data.result.map((r) => ({
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
    return data.result.map((row) => ({
      fm: toFairminter(row),
      phase: row.phase,
      conforming: true as const,
      xcpDepth: BigInt(Math.trunc(row.pool_xcp_sats) || 0),
      poolXcpReserve: row.pool_xcp_reserve,
      poolTokenReserve: row.pool_token_reserve,
      announceBlock: row.announce_block,
      minters: row.minters,
    }));
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
    /** Bitcoin satoshi spent on mint transaction fees. */
    fee_sats: number;
  };
  /** Mints per ~144-block bucket; `bucket` is `block_index / 144`. */
  daily: { bucket: number; n: number; minters: number }[];
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
