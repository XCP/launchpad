import { NextResponse } from "next/server";
import { verifyBip322 } from "@/lib/bip322";
import {
  getMetadataBucket,
  metadataIconUrl,
  metadataImageUrl,
  metadataJsonUrl,
} from "@/lib/metadata";

import { sanitizeHandle } from "@/lib/social";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";

/** Counterparty named assets: start B-Z, 4-12 uppercase letters. */
const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
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
  const xHandle = sanitizeHandle(String(form.get("x") ?? ""));
  const telegram = sanitizeHandle(String(form.get("telegram") ?? ""));
  const image = form.get("image");

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
    return NextResponse.json({ error: "Image too large (max 2 MB)" }, { status: 400 });
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
    ...(xHandle ? [{ type: "twitter", data: `https://x.com/${xHandle}` }] : []),
    ...(telegram ? [{ type: "telegram", data: `https://t.me/${telegram}` }] : []),
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
    return NextResponse.json({ error: "Image too large (max 2 MB)" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(issued) ||
    now - issued > EDIT_MAX_AGE_SECONDS ||
    issued - now > EDIT_MAX_FUTURE_SKEW_SECONDS
  ) {
    return NextResponse.json({ error: "Signature expired — try again" }, { status: 401 });
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
  if (!owner || owner !== address) {
    return NextResponse.json(
      { error: "Only the asset's current owner can edit its info" },
      { status: 403 },
    );
  }

  const bucket = await getMetadataBucket();
  const existing = await bucket.get(`j/${asset}`);
  if (!existing) {
    return NextResponse.json(
      { error: `No metadata exists for ${asset}` },
      { status: 404 },
    );
  }
  const current = JSON.parse(await new Response(existing.body).text()) as {
    images?: { type: string; size?: string; data: string; hash?: string }[];
  };

  let imageHash = current.images?.find((i) => i.type === "standard")?.hash;
  if (newImageBytes && newImage) {
    imageHash = imageSha;
    await bucket.put(`i/${asset}`, newImageBytes, {
      httpMetadata: { contentType: newImage.type },
    });
  }

  const xHandle = sanitizeHandle(xRaw);
  const telegram = sanitizeHandle(telegramRaw);
  const social = [
    ...(xHandle ? [{ type: "twitter", data: `https://x.com/${xHandle}` }] : []),
    ...(telegram ? [{ type: "telegram", data: `https://t.me/${telegram}` }] : []),
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
    ...(social.length > 0 ? { social } : {}),
  });
  await bucket.put(`j/${asset}`, json, {
    httpMetadata: { contentType: "application/json" },
  });

  return NextResponse.json({ json_url: metadataJsonUrl(asset) });
}
