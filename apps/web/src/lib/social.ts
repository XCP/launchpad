/**
 * Social links, normalized to a canonical URL.
 *
 * A handle is not the only useful thing to link. A launch is often announced
 * in one specific post, and that post is a better destination than the
 * profile it happens to sit on — so a pasted status or message URL is kept
 * whole rather than being reduced to the account that wrote it.
 *
 * Accepts a bare handle, an @handle, a profile URL, or a deep link, and
 * returns a full canonical URL — or "" if the input can't be either.
 */

const HANDLE = /^[A-Za-z0-9_]{1,32}$/;
const DIGITS = /^[0-9]{1,25}$/;
/** Telegram invite links are `t.me/+<opaque>` and carry no handle. */
const INVITE = /^\+[A-Za-z0-9_-]{1,64}$/;

/** Strip protocol, host, and any query or fragment; return the path segments. */
function pathParts(input: string, hosts: RegExp): string[] | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const withoutHost = trimmed.replace(/^https?:\/\/(www\.)?/i, "");
  const hasHost = /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(withoutHost);
  if (hasHost && !hosts.test(withoutHost)) return null;
  const path = hasHost ? withoutHost.slice(withoutHost.indexOf("/") + 1) : withoutHost;
  return path
    .split(/[?#]/)[0]!
    .split("/")
    .filter((s) => s !== "")
    .map((s) => s.replace(/^@/, ""));
}

/**
 * X: a profile, or a specific post. `i/status/<id>` is the form X itself
 * produces when the author is unknown to the sharer, and is kept as given.
 */
export function sanitizeX(input: string): string {
  const parts = pathParts(input, /^(x\.com|twitter\.com)\//i);
  if (!parts || parts.length === 0) return "";
  const [handle, kind, id] = parts;
  if (!handle || !HANDLE.test(handle)) return "";
  if (parts.length === 1) return `https://x.com/${handle}`;
  if ((kind === "status" || kind === "statuses") && id && DIGITS.test(id)) {
    return `https://x.com/${handle}/status/${id}`;
  }
  return "";
}

/** Telegram: a channel or user, a specific message within one, or an invite. */
export function sanitizeTelegram(input: string): string {
  const parts = pathParts(input, /^t\.me\//i);
  if (!parts || parts.length === 0) return "";
  const [name, messageId] = parts;
  if (!name) return "";
  if (INVITE.test(name)) return parts.length === 1 ? `https://t.me/${name}` : "";
  if (!HANDLE.test(name)) return "";
  if (parts.length === 1) return `https://t.me/${name}`;
  if (messageId && DIGITS.test(messageId)) return `https://t.me/${name}/${messageId}`;
  return "";
}

/** Empty is fine (optional field); anything non-empty must normalize cleanly. */
export function isValidX(input: string): boolean {
  return input.trim() === "" || sanitizeX(input) !== "";
}

export function isValidTelegram(input: string): boolean {
  return input.trim() === "" || sanitizeTelegram(input) !== "";
}
