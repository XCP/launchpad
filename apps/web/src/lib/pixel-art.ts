/**
 * Launches whose art is pixel art, and must not be smoothed when scaled.
 *
 * LORDFUN's art is a Bitcoin Stamp: an 80x80 GIF (the CDN's icon copy is
 * 48x48) that the launch page renders into a box several times that size.
 * The browser's default scaling interpolates, so every hard pixel edge comes
 * out as a gradient and the art reads as a blurry JPEG of itself.
 * `image-rendering: pixelated` is the whole treatment.
 *
 * Hardcoded deliberately, for now. Nothing in a launch record says "this is
 * pixel art": the honest signal is a tiny intrinsic size, and that is only
 * knowable after the image has decoded in the browser — which means either
 * measuring every image on every render, or keeping a server-side size index.
 * A list of one asset does not pay for either. If this list grows past a
 * handful, measure instead of listing.
 */
const PIXEL_ART: ReadonlySet<string> = new Set(["LORDFUN"]);

/** The class to add to an <img> for this asset, or "" for ordinary art. */
export function pixelArtClass(asset: string): string {
  return PIXEL_ART.has(asset.toUpperCase()) ? " [image-rendering:pixelated]" : "";
}
