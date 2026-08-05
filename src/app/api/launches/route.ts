import { NextResponse } from "next/server";
import {
  getMetadataBucket,
  metadataIconUrl,
  metadataImageUrl,
  metadataJsonUrl,
} from "@/lib/metadata";

import { sanitizeHandle } from "@/lib/social";

/** Counterparty named assets: start B-Z, 4-12 uppercase letters. */
const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION_CHARS = 2000;

/**
 * Stores a launch's image + enhanced-asset-info JSON, write-once. Called from
 * the create flow before composing the fairminter, so the on-chain description
 * URL resolves from the first block.
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

  // Write-once: locked on-chain descriptions must not point at mutable files.
  if (await bucket.head(`j/${asset}`)) {
    return NextResponse.json(
      { error: `Metadata for ${asset} already exists` },
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
    website: `https://xcp.fun/launch/${asset}`,
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
