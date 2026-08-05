import { NextResponse } from "next/server";
import {
  getMetadataBucket,
  metadataImageUrl,
  metadataJsonUrl,
} from "@/lib/metadata";

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
  const description = String(form.get("description") ?? "").trim();
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

  await bucket.put(`i/${asset}`, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type },
  });
  const json = JSON.stringify({
    asset,
    description,
    image: metadataImageUrl(asset),
    website: "https://xcp.fun",
  });
  await bucket.put(`j/${asset}`, json, {
    httpMetadata: { contentType: "application/json" },
  });

  return NextResponse.json({ json_url: metadataJsonUrl(asset) });
}
