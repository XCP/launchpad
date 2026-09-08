import { createHash, timingSafeEqual } from "node:crypto";

/** Hash to fixed-width bytes so secret length does not select a compare path. */
export function authed(supplied: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied ?? ""), digest(expected));
}
