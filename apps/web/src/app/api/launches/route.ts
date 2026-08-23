import { NextResponse } from "next/server";
import { verifyBip322 } from "@/lib/bip322";
import {
  getMetadataBucket,
  metadataIconUrl,
  metadataImageUrl,
  metadataJsonUrl,
  purgeMetadataCache,
  updateIndexedDescription,
} from "@/lib/metadata";

import {
  SESSION_COOKIE,
  readCookie,
  readSession,
  sameOrigin,
} from "@/lib/session";
import { sanitizeTelegram, sanitizeX } from "@/lib/social";
import {
  COUNTERPARTY_API_BASE,
  inscriptionContentUrl,
  inscriptionId,
  inscriptionPageUrl,
} from "@/lib/constants";

/** Counterparty named assets: start B-Z, 4-12 uppercase letters. */
const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_MB = 4;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
/** Written from the limit rather than beside it — the two error strings below
 *  both used to spell the number out, which is two more places to miss when
 *  the ceiling moves. The label in create/page.tsx is the one copy that can't
 *  import this (server module), and it says so there. */
const TOO_LARGE = `Image too large (max ${MAX_IMAGE_MB} MB)`;
const MAX_DESCRIPTION_CHARS = 2000;

const sha256Hex = async (bytes: ArrayBuffer) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** Whether any fairminter transaction has actually confirmed on-chain for
 *  this asset — as opposed to one that was composed but rejected by
 *  consensus (recorded `status: "invalid: ..."`), which claims nothing. */
async function assetHasRealFairminter(asset: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${COUNTERPARTY_API_BASE}/assets/${asset}/fairminters?limit=100&verbose=true`,
      { cache: "no-store" },
    );
    if (!res.ok) return true; // Can't confirm it's safe — fail closed.
    const data = (await res.json()) as { result?: { status?: string }[] };
    return (data.result ?? []).some((fm) => !fm.status?.startsWith("invalid"));
  } catch {
    return true; // Same: an unknown Counterparty state must not unblock a name.
  }
}

/** A CBOR-free, registry-agnostic pointer to the launch's inscription, for
 *  the JSON below. The id is the durable fact; the URLs are the convenience.
 *
 *  Every inscribed launch's hosted JSON is an orphan — nothing on-chain
 *  points at it, because for an inscription the description IS the content,
 *  not a URL. That cuts both ways: the JSON is the only place that can carry
 *  a human-followable link back to the artifact, and it is the only record
 *  tying our copy of the art to the thing the token actually is. Without it,
 *  a reader who found this file would see `image: xcp.fun/full/ASSET` and
 *  have no way to know the canonical bytes live on Bitcoin. */
function inscriptionRecord(
  revealTxid: string,
  contentType?: string | null,
): Record<string, string> {
  return {
    id: inscriptionId(revealTxid),
    ...(contentType ? { content_type: contentType } : {}),
    content_url: inscriptionContentUrl(revealTxid),
    page_url: inscriptionPageUrl(revealTxid),
  };
}

/** The asset's real (non-rejected) fairminter, when it has one. `mime_type`
 *  is what makes a launch inscribed; `tx_hash` is the reveal that carries it. */
async function fetchRealFairminter(
  asset: string,
): Promise<{ tx_hash?: string; mime_type?: string; status?: string } | null> {
  try {
    const res = await fetch(
      `${COUNTERPARTY_API_BASE}/assets/${asset}/fairminters?limit=100&verbose=true`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { tx_hash?: string; mime_type?: string; status?: string }[];
    };
    return (data.result ?? []).find((fm) => !fm.status?.startsWith("invalid")) ?? null;
  } catch {
    return null;
  }
}

/**
 * Stores a launch's image + enhanced-asset-info JSON, called from the create
 * flow before composing the fairminter (so the on-chain description URL
 * resolves from the first block). Freely (re)writable up until a real
 * fairminter exists for the asset — see assetHasRealFairminter — at which
 * point this route refuses and further edits go through PUT below instead,
 * gated by a BIP-322 signature from the asset's current owner.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const asset = String(form.get("asset") ?? "").toUpperCase();
  const name = String(form.get("name") ?? "").trim().slice(0, 127);
  const description = String(form.get("description") ?? "").trim();
  const xUrl = sanitizeX(String(form.get("x") ?? ""));
  const telegramUrl = sanitizeTelegram(String(form.get("telegram") ?? ""));
  const image = form.get("image");
  // Written by the create flow's second pass: the first one runs before the
  // inscription exists, so the reveal txid — and with it the inscription id —
  // is only knowable once the envelope has been broadcast.
  const inscriptionTxid = String(form.get("inscription_txid") ?? "").toLowerCase();
  const inscribed = /^[0-9a-f]{64}$/.test(inscriptionTxid);

  if (!ASSET_NAME_REGEX.test(asset)) {
    return NextResponse.json({ error: "Invalid asset name" }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json({ error: "Description too long" }, { status: 400 });
  }
  if (!(image instanceof File) || !IMAGE_TYPES.has(image.type)) {
    return NextResponse.json(
      { error: "Image must be PNG, JPEG, WEBP, or GIF" },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 400 });
  }

  const bucket = await getMetadataBucket();

  // The permalink is immutable — it's what the locked on-chain description
  // points at forever — but the JSON hosted at it is just centralized
  // storage, free to overwrite right up until a real launch exists. This
  // route runs before the fairminter is even composed, so a failed or
  // abandoned attempt (wrong fee, rejected signature, insufficient funds,
  // a closed tab) must leave the name retryable — Counterparty never
  // reserved anything, only this write did, and treating that write as
  // permanent burns the name for nothing. Once a fairminter is real,
  // though, this route stops being the write path: further changes go
  // through PUT below, owner-signature gated. A composed-but-rejected
  // attempt is recorded on-chain as `status: "invalid: ..."` (same shape
  // core uses for fairmints); only a non-invalid row counts as real.
  if (await assetHasRealFairminter(asset)) {
    return NextResponse.json(
      { error: `${asset} has already launched` },
      { status: 409 },
    );
  }

  const imageBytes = await image.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", imageBytes);
  const imageHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await bucket.put(`i/${asset}`, imageBytes, {
    httpMetadata: { contentType: image.type },
  });

  // CIP-25 v2 Enhanced Asset Information (required: asset, name). The image
  // hash makes the write-once JSON an integrity commitment: locked on-chain
  // description URL → hashed content.
  const social = [
    ...(xUrl ? [{ type: "twitter", data: xUrl }] : []),
    ...(telegramUrl ? [{ type: "telegram", data: telegramUrl }] : []),
  ];
  const json = JSON.stringify({
    asset,
    name: name || asset,
    description,
    website: `https://xcp.fun/${asset}`,
    // Deprecated in v2 but still read by older parsers.
    image: metadataImageUrl(asset),
    images: [
      { type: "icon", size: "48x48", data: metadataIconUrl(asset) },
      { type: "standard", data: metadataImageUrl(asset), hash: imageHash },
    ],
    // The bytes above are our copy of the art; on an inscribed launch the
    // originals are the on-chain description itself, and this is what says so.
    ...(inscribed
      ? { inscription: inscriptionRecord(inscriptionTxid, image.type) }
      : {}),
    ...(social.length > 0 ? { social } : {}),
  });
  await bucket.put(`j/${asset}`, json, {
    httpMetadata: { contentType: "application/json" },
  });

  return NextResponse.json({ json_url: metadataJsonUrl(asset) });
}

const EDIT_MAX_AGE_SECONDS = 300;
const EDIT_MAX_FUTURE_SKEW_SECONDS = 60;

/**
 * Issuer-gated edit of an existing launch's hosted metadata. The on-chain
 * description URL is locked forever; the content behind it is curated by
 * whoever currently owns the asset on-chain.
 *
 * Authentication: a BIP-322 signature (the wallet's native signMessage) over
 * a challenge that binds the asset, the signing address, a timestamp, and a
 * hash of the exact new content — so a captured signature can neither be
 * replayed later nor spent on different content.
 * Authorization: the signing address must be the asset's current owner per
 * the Counterparty API.
 */
export async function PUT(request: Request) {
  const form = await request.formData();
  const asset = String(form.get("asset") ?? "").toUpperCase();
  const name = String(form.get("name") ?? "").trim().slice(0, 127);
  const description = String(form.get("description") ?? "").trim();
  const xRaw = String(form.get("x") ?? "");
  const telegramRaw = String(form.get("telegram") ?? "");
  const image = form.get("image");
  const address = String(form.get("address") ?? "");
  const signature = String(form.get("signature") ?? "");
  const issued = Number(form.get("issued"));

  if (!ASSET_NAME_REGEX.test(asset)) {
    return NextResponse.json({ error: "Invalid asset name" }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json({ error: "Description too long" }, { status: 400 });
  }
  const newImage = image instanceof File && image.size > 0 ? image : null;
  if (newImage && !IMAGE_TYPES.has(newImage.type)) {
    return NextResponse.json(
      { error: "Image must be PNG, JPEG, WEBP, or GIF" },
      { status: 400 },
    );
  }
  if (newImage && newImage.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 400 });
  }

  // Two ways to prove who is asking. A session cookie is the normal one: the
  // wallet's connect-time proof was verified server-side already, so there is
  // nothing left for the user to sign. The per-request signature remains as a
  // fallback for when sessions aren't configured or have lapsed — it is
  // strictly stronger (it commits to the exact payload), just costlier, since
  // signMessage opens the wallet whereas the connection proof is auto-signed.
  const sessionAddress = await readSession(readCookie(request, SESSION_COOKIE));
  const actor = sessionAddress && sameOrigin(request) ? sessionAddress : null;

  if (!actor) {
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isFinite(issued) ||
      now - issued > EDIT_MAX_AGE_SECONDS ||
      issued - now > EDIT_MAX_FUTURE_SKEW_SECONDS
    ) {
      return NextResponse.json({ error: "Signature expired — try again" }, { status: 401 });
    }
  }

  // Recompute the content hash from what was actually received; the client
  // hashed the same canonical JSON before signing. Raw field values on
  // purpose — sanitization happens after the signature checks out.
  const newImageBytes = newImage ? await newImage.arrayBuffer() : null;
  const imageSha = newImageBytes ? await sha256Hex(newImageBytes) : "";
  const payload = JSON.stringify({
    asset,
    name,
    description,
    x: xRaw,
    telegram: telegramRaw,
    image_sha256: imageSha,
  });
  const payloadHash = await sha256Hex(new TextEncoder().encode(payload).buffer as ArrayBuffer);
  const message = `xcp-fun-edit\nasset:${asset}\naddress:${address}\nissued:${issued}\npayload:${payloadHash}`;

  if (!actor) {
    try {
      if (!verifyBip322(address, message, signature)) {
        return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Unsupported address type" },
        { status: 400 },
      );
    }
  }
  const editor = actor ?? address;

  // Authorization follows on-chain ownership, live — not the launch creator,
  // not a session: whoever owns the asset now curates its metadata.
  const assetRes = await fetch(`${COUNTERPARTY_API_BASE}/assets/${asset}`, {
    cache: "no-store",
  });
  if (!assetRes.ok) {
    return NextResponse.json({ error: "Asset lookup failed" }, { status: 502 });
  }
  const assetInfo = (await assetRes.json()).result as
    | { owner?: string; issuer?: string }
    | null;
  const owner = assetInfo?.owner ?? assetInfo?.issuer;
  if (!owner || owner !== editor) {
    return NextResponse.json(
      { error: "Only the asset's current owner can edit its info" },
      { status: 403 },
    );
  }

  const bucket = await getMetadataBucket();
  // Create if absent, don't refuse. Launches composed here have their JSON
  // written before broadcast, so an existing file used to be a safe
  // assumption — but a fairminter composed anywhere else has never had one,
  // and refusing those told the owner of a real XCP-69 launch "No metadata
  // exists for GENXSIXNINE" with no path to ever making some exist. What
  // authorizes this write is owning the asset, checked above; whether we
  // already hold a file is a fact about us, not about the asker.
  const existing = await bucket.get(`j/${asset}`);
  const current = existing
    ? ((await new Response(existing.body).json().catch(() => null)) as {
        images?: { type: string; size?: string; data: string; hash?: string }[];
        inscription?: Record<string, string>;
      } | null)
    : null;

  // Derived from the chain rather than carried over, because the chain is
  // where the answer actually lives and an edit is a cheap moment to ask: one
  // request, on a route that already makes two. This is also the only way an
  // inscribed launch composed OUTSIDE xcp.fun ever gets the link — nothing in
  // our create flow ran for it, so nobody wrote the record at launch time.
  // A lookup that fails keeps whatever the file already had, so a Counterparty
  // hiccup can't quietly strip the pointer.
  const fairminter = await fetchRealFairminter(asset);
  const inscribedType =
    fairminter?.mime_type && fairminter.mime_type !== "text/plain"
      ? fairminter.mime_type
      : null;
  const inscription =
    inscribedType && fairminter?.tx_hash
      ? inscriptionRecord(fairminter.tx_hash, inscribedType)
      : current?.inscription;

  let imageHash = current?.images?.find((i) => i.type === "standard")?.hash;
  if (newImageBytes && newImage) {
    imageHash = imageSha;
    await bucket.put(`i/${asset}`, newImageBytes, {
      httpMetadata: { contentType: newImage.type },
    });
  }

  const xUrl = sanitizeX(xRaw);
  const telegramUrl = sanitizeTelegram(telegramRaw);
  const social = [
    ...(xUrl ? [{ type: "twitter", data: xUrl }] : []),
    ...(telegramUrl ? [{ type: "telegram", data: telegramUrl }] : []),
  ];
  const json = JSON.stringify({
    asset,
    name: name || asset,
    description,
    website: `https://xcp.fun/${asset}`,
    image: metadataImageUrl(asset),
    images: [
      { type: "icon", size: "48x48", data: metadataIconUrl(asset) },
      {
        type: "standard",
        data: metadataImageUrl(asset),
        ...(imageHash ? { hash: imageHash } : {}),
      },
    ],
    ...(inscription ? { inscription } : {}),
    ...(social.length > 0 ? { social } : {}),
  });
  await bucket.put(`j/${asset}`, json, {
    httpMetadata: { contentType: "application/json" },
  });
  // D1 is what the site actually renders — the card blurb, the detail
  // blockquote, the share unfurl — and for a launch whose on-chain
  // description points somewhere that isn't ours (an inscription, a
  // third-party host) it is the ONLY place these words can appear. The R2
  // JSON above stays the canonical published copy either way.
  await updateIndexedDescription(asset, description);
  await purgeMetadataCache([
    `/j/${encodeURIComponent(asset)}.json`,
    ...(newImageBytes ? [`/i/${encodeURIComponent(asset)}`] : []),
  ]);

  return NextResponse.json({ json_url: metadataJsonUrl(asset) });
}
