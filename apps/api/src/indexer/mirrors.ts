/**
 * Art mirrors: keeping ONE named launch's picture current, for a fixed number
 * of blocks, and then never again.
 *
 * A launch opened somewhere other than this site points its on-chain
 * description at its own host, and we store nothing for it — so the site falls
 * through to cdn.xcp.io, which ingests an asset once and answers with a grey
 * placeholder for anything it has not seen. That is fine for the ordinary
 * case, where a token's art is decided before it launches and never moves.
 *
 * EVOLVEDPEPE is not the ordinary case. Its creator advances the picture a
 * stage for every 5% of the raise — twenty-one stages, each a new filename on
 * their server — and expected the ecosystem to follow along. Nothing here
 * does: this app is event-driven off the chain, not a crawler over issuer
 * metadata, and that is a deliberate design, not an oversight. Crawling every
 * launch's JSON on a timer would mean fetching a great deal of mostly broken
 * metadata forever, to serve a feature almost no launch uses.
 *
 * So this is the narrow version of that, and the narrowness IS the design:
 *
 *   - a hardcoded list, not a discovery mechanism. Nothing a creator writes
 *     on-chain can add an entry; only a deploy can.
 *   - one URL per entry, fixed here, never read from the description.
 *   - an expiry in blocks. Past `untilBlock` an entry does nothing, forever.
 *     Nobody has to remember to switch it off, and forgetting is harmless.
 *
 * It is still the one place this worker reaches an issuer-controlled URL,
 * which src/indexer/sync.ts otherwise forbids outright. That rule guards
 * against a cron wandering through arbitrary metadata chosen by strangers.
 * This wanders nowhere: same address every tick, chosen here, until a block
 * height that has already been decided.
 *
 * What it writes is a MIRROR — `m/<ASSET>`, not `i/<ASSET>`. The web worker
 * serves mirrors with a five-minute TTL precisely because they are copies of
 * a file somebody else controls, so an overwrite here reaches people on its
 * own and nothing needs purging. See apps/web/src/app/i/[asset]/route.ts.
 */

/** One launch whose art moves, and how long we agree to follow it. */
export interface MirrorTarget {
  asset: string;
  /** The creator's enhanced-asset-info JSON. Fixed here on purpose — read
   *  from this constant, never from the launch's on-chain description, so a
   *  repointed description cannot redirect this job. */
  metadata: string;
  /** Last block this entry does anything. Past it, permanently inert. */
  untilBlock: number;
}

/**
 * EVOLVEDPEPE mints from block 964101 to 965101 — the standard's 1,000-block
 * window, about seven days. The six-block tail past its deadline is what
 * catches the final image: the creator publishes the finished art once the
 * launch settles, and an hour of slack picks that up without anyone doing it
 * by hand.
 *
 * A sell-out ends the launch earlier than the deadline — core pulls
 * soft_cap_deadline_block forward to the settling block when the hard cap is
 * reached — and this ceiling does not move with it. That costs a few more
 * no-op ticks against an unchanging JSON and nothing else.
 */
export const MIRRORS: MirrorTarget[] = [
  {
    asset: "EVOLVEDPEPE",
    metadata: "https://pepedust.com/j/EVOLVEDPEPE.json",
    untilBlock: 965_107,
  },
];

/** A foreign host on a cron tick that shares its budget with the indexer. */
const FETCH_TIMEOUT_MS = 5_000;

/** Metadata is a small JSON document. Anything at this size is not one. */
const MAX_METADATA_BYTES = 256 * 1024;

/** Room for real art — EVOLVEDPEPE's stages run about 880 KB — and a ceiling
 *  on what a pointer we do not own can hand us. */
const MAX_ART_BYTES = 8 * 1024 * 1024;

export interface MirrorRefresh {
  /** Entries still inside their block window. */
  checked: number;
  /** Entries past `untilBlock`, doing nothing. */
  expired: number;
  /** Checked, and the creator's JSON still names the picture we hold. */
  unchanged: number;
  /** A new stage copied into R2. */
  updated: number;
  /** Their host was unreachable, slow, or answered with something that
   *  wasn't a picture. The existing mirror stays exactly as it is. */
  failed: number;
}

interface EnhancedAssetInfo {
  image?: unknown;
  images?: unknown;
}

/** One foreign hop, deadlined and size-capped. Null for anything that isn't a
 *  clean answer — every caller treats that as "leave the mirror alone". */
async function fetchBounded(
  url: string,
  maxBytes: number,
  init: RequestInit = {},
): Promise<Response | null> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return null;
  // Advisory only — a chunked response declares nothing — but it costs one
  // header read to refuse the obvious case before pulling the body.
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
  return res;
}

/**
 * The full-size picture an enhanced-asset-info document names.
 *
 * CIP-25 v2 puts it in `images[]` by type, which is what this site writes and
 * what pepedust.com writes; `image` is the deprecated v1 field, still emitted
 * by older generators and worth reading as a last resort.
 */
export function pickArtUrl(meta: EnhancedAssetInfo | null): string | null {
  const images = Array.isArray(meta?.images) ? meta.images : [];
  const byType = (type: string): string | null => {
    const hit = images.find(
      (entry): entry is { type: string; data: string } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === type &&
        typeof (entry as { data?: unknown }).data === "string",
    );
    return hit?.data ?? null;
  };
  const chosen =
    byType("standard") ??
    byType("icon") ??
    (typeof meta?.image === "string" ? meta.image : null);
  if (!chosen) return null;
  try {
    // https only: an http source would be a mixed-content image on our pages
    // even before it is a fetch this worker should not make.
    return new URL(chosen).protocol === "https:" ? chosen : null;
  } catch {
    return null;
  }
}

/**
 * Copy each live target's current art into R2, if it has moved.
 *
 * The stored object remembers which URL it came from in its custom metadata,
 * and every stage is a new filename, so "has it moved" is a string comparison
 * against a head — no image is transferred, and no object is rewritten, on a
 * tick where nothing changed. Which is nearly all of them: stages advance
 * with the raise, and this runs every five minutes.
 */
export async function refreshMirrors(
  bucket: R2Bucket,
  height: number,
): Promise<MirrorRefresh> {
  const result: MirrorRefresh = {
    checked: 0,
    expired: 0,
    unchanged: 0,
    updated: 0,
    failed: 0,
  };

  for (const target of MIRRORS) {
    if (height > target.untilBlock) {
      result.expired += 1;
      continue;
    }
    result.checked += 1;

    const metaRes = await fetchBounded(target.metadata, MAX_METADATA_BYTES, {
      headers: { accept: "application/json" },
    });
    if (!metaRes) {
      result.failed += 1;
      continue;
    }
    const meta = (await metaRes.json().catch(() => null)) as EnhancedAssetInfo | null;
    const artUrl = pickArtUrl(meta);
    if (!artUrl) {
      result.failed += 1;
      continue;
    }

    const key = `m/${target.asset}`;
    const held = await bucket.head(key);
    if (held?.customMetadata?.source === artUrl) {
      result.unchanged += 1;
      continue;
    }

    const art = await fetchBounded(artUrl, MAX_ART_BYTES);
    const contentType = art?.headers.get("content-type") ?? "";
    if (!art || !contentType.startsWith("image/")) {
      result.failed += 1;
      continue;
    }
    const bytes = await art.arrayBuffer().catch(() => null);
    // Re-check after the body: content-length is advisory, and this is the
    // first point the real size is known.
    if (!bytes || bytes.byteLength > MAX_ART_BYTES) {
      result.failed += 1;
      continue;
    }

    await bucket.put(key, bytes, {
      httpMetadata: { contentType },
      // What the next tick compares against, and the only record of where
      // these bytes came from.
      customMetadata: { source: artUrl },
    });
    result.updated += 1;
  }

  return result;
}
