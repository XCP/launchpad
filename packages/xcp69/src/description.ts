/**
 * What a fairminter's on-chain `description` field actually IS.
 *
 * Counterparty gives one field four different jobs, and every consumer here
 * has to tell them apart before it can render anything:
 *
 *   - `hosted`      a URL to enhanced-asset-info JSON (ours or someone's)
 *   - `prose`       the creator's own words, written straight on-chain
 *   - `inscription` content, not text: an image, an HTML app, an SVG. The
 *                   fairminter's `mime_type` says so; for anything that has
 *                   lost the mime_type (D1 stores the description but not the
 *                   type) the shape of the bytes is the remaining signal.
 *   - `empty`       nothing worth showing
 *
 * Getting this wrong is not cosmetic. A `text/html` inscription reads as a
 * 33 KB string that is technically "text", so treating "not a URL" as "must
 * be prose" put `<!doctype html><html lang="en"><head><meta charset=...` in
 * the description blockquote, in the D1 display mirror, and in the og:
 * description of every shared link. Both apps classify with this one
 * function so they cannot disagree about it.
 */
export type DescriptionKind = "empty" | "inscription" | "url" | "prose";

/** Opening angle bracket of a document/tag: `<!doctype`, `<html`, `<svg`,
 *  `<?xml`, `</`. Prose does not start this way. */
const MARKUP_START = /^<[a-z!?/]/i;

/** Control bytes that no human description contains — the tell for binary
 *  content (a PNG's header, say) that arrived as a string. Tab, newline and
 *  carriage return are excluded: prose has those. */
// eslint-disable-next-line no-control-regex
const BINARY_BYTE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

const HTTP_URL = /^https?:\/\//i;

/**
 * `mimeType` is authoritative when present — an inscribed launch declares its
 * own content type, and "text/plain" is what a plain description carries.
 * Callers that no longer have it (the indexer reads D1, which stores the
 * description text alone) pass nothing and fall back to the shape checks.
 */
export function classifyDescription(
  description: string | null | undefined,
  mimeType?: string | null,
): DescriptionKind {
  const text = typeof description === "string" ? description.trim() : "";
  const base = (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
  if (base && base !== "text/plain") return text ? "inscription" : "empty";
  if (!text) return "empty";
  if (MARKUP_START.test(text) || BINARY_BYTE.test(text)) return "inscription";
  if (HTTP_URL.test(text)) return "url";
  return "prose";
}

/**
 * The creator's words, or "" when this description isn't words. The length
 * floor and the it's-just-the-ticker check are what keep a one-word
 * "description" from earning a blockquote of its own.
 */
export function proseDescription(
  description: string | null | undefined,
  mimeType?: string | null,
  asset?: string,
): string {
  if (classifyDescription(description, mimeType) !== "prose") return "";
  const text = (description ?? "").trim();
  if (text.length <= 12) return "";
  if (asset && text.toUpperCase() === asset.toUpperCase()) return "";
  return text;
}
