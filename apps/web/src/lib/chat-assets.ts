import { CHAT_MAX_RAW_BYTES } from "@launchpad/chat";

export interface ChatCashtag {
  /** UTF-16 offsets, for slicing the original message without rewriting it. */
  start: number;
  end: number;
  /** Exact visible spelling, including $. */
  tag: string;
  /** Uppercase named asset, suitable for an exact index lookup. */
  asset: string;
}

// The launch page and XCP-69 support named assets only. Core subasset longnames
// resolve to numeric assets; neither is a supported /[asset] launch route.
const NAMED_ASSET = /^[B-Z][A-Z]{3,11}$/;
const IDENTIFIER_EDGE = /[\p{L}\p{N}\p{M}\p{Cf}_$@/\\.%&=+~#?-]/u;

/** Find complete standalone cashtags, never a prefix of a longer identifier.
 * URL/email tokens and literal markup/code remain unchanged plain text. */
export function parseChatCashtags(text: string): readonly ChatCashtag[] {
  if (text.length > CHAT_MAX_RAW_BYTES) return [];
  const excluded: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/<[^>]*>|&lt;[\s\S]*?&gt;|`[^`]*`|\S*(?:[A-Za-z][A-Za-z0-9+.-]*:|www\.)[^\s]*/gi)) {
    excluded.push({ start: match.index, end: match.index + match[0].length });
  }
  const tags: ChatCashtag[] = [];
  for (const match of text.matchAll(/\$([A-Za-z][A-Za-z0-9_.@!-]*)/g)) {
    if (tags.length >= 64) break;
    const start = match.index;
    // Sentence-final punctuation is not part of a named asset. Interior dots
    // and punctuation remain in the candidate, so $PARENT.child cannot link
    // its parent, nor can $PEPE-WORD turn into a misleading $PEPE link.
    const name = match[1].replace(/[.!]+$/, "");
    const asset = name.toUpperCase();
    const end = start + name.length + 1;
    if ((asset !== "XCP" && !NAMED_ASSET.test(asset)) || excluded.some((range) => start >= range.start && start < range.end)) continue;
    const before = start > 0 ? text[start - 1] : "";
    const after = text[end] ?? "";
    if ((before && IDENTIFIER_EDGE.test(before)) || (after && /[\p{L}\p{N}\p{M}\p{Cf}_$@/\\%&=+~#?-]/u.test(after))) continue;
    tags.push({ start, end, tag: text.slice(start, end), asset });
  }
  return tags;
}

/** Runtime validation: a field named `asset` is not itself a safe URL. This
 * index is the only membership source; no route is inferred from a longname. */
export function chatAssetIndex(value: unknown): ReadonlyMap<string, string> {
  const links = new Map<string, string>();
  if (!Array.isArray(value)) return links;
  for (const row of value) {
    if (!row || typeof row !== "object" || typeof row.asset !== "string"
      || row.asset.trim() !== row.asset || !NAMED_ASSET.test(row.asset)) continue;
    links.set(row.asset, `/${row.asset}`);
  }
  return links;
}
