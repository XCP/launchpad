/**
 * Accepts a pasted profile URL ("https://x.com/handle"), an "@handle", or a
 * bare handle, and returns the bare handle — or "" if it can't be one.
 * Shared by the create form (validation) and the metadata API (canonical URL).
 */
export function sanitizeHandle(input: string): string {
  const bare = input
    .trim()
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com|t\.me)\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]!;
  return /^[A-Za-z0-9_]{1,32}$/.test(bare) ? bare : "";
}

/** Empty is fine (optional field); anything non-empty must sanitize cleanly. */
export function isValidSocial(input: string): boolean {
  return input.trim() === "" || sanitizeHandle(input) !== "";
}
