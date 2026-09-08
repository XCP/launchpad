/**
 * Address sessions: the connection proof, promoted to a login.
 *
 * A supported wallet supplies a signed connection proof. Verified SERVER-side,
 * that proof demonstrates
 * control of the address's key, bound to this origin and a timestamp. So we
 * check it once and hand back a cookie, instead of asking the wallet to sign
 * every individual write.
 *
 * The token is a stateless HMAC over {address, expiry}: no session table, so
 * nothing to store, expire, or bill (D1 charges per row touched, and a session
 * read on every request is exactly the kind of write-amplification this repo
 * avoids). The cost of statelessness is that a session can't be revoked before
 * it expires. It establishes address identity; individual write paths must
 * still enforce their own permissions, such as current asset ownership.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const SESSION_COOKIE = "xcpfun_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionDetails {
  address: string;
  /** Unix seconds, from the signed cookie payload. */
  expiresAt: number;
}

async function signingKey(): Promise<CryptoKey> {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as Record<string, unknown>).SESSION_SECRET as string | undefined;
  if (!secret) throw new Error("SESSION_SECRET not configured");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function issueSession(address: string): Promise<string> {
  const payload = JSON.stringify({
    a: address,
    e: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const bytes = new TextEncoder().encode(payload);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), bytes));
  return `${b64url(bytes)}.${b64url(sig)}`;
}

/** The address this token attests to, or null for anything not currently
 *  valid — including an unset SESSION_SECRET, so a missing secret degrades to
 *  "no sessions exist" and the per-edit signature path still works. */
export async function readSessionDetails(token: string | undefined): Promise<SessionDetails | null> {
  if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, sig] = token.split(".");
  try {
    const bytes = unb64url(payload);
    const ok = await crypto.subtle.verify("HMAC", await signingKey(), unb64url(sig), bytes);
    if (!ok) return null;
    const { a, e } = JSON.parse(new TextDecoder().decode(bytes)) as { a?: unknown; e?: unknown };
    if (typeof a !== "string" || !a || typeof e !== "number" || !Number.isSafeInteger(e)) return null;
    if (e <= Math.floor(Date.now() / 1000)) return null;
    return { address: a, expiresAt: e };
  } catch {
    return null;
  }
}

export async function readSession(token: string | undefined): Promise<string | null> {
  return (await readSessionDetails(token))?.address ?? null;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * A cookie is sent by the browser regardless of who caused the request, so
 * cookie-authenticated writes need their own cross-site check. SameSite=Strict
 * on the cookie is the primary defense; this is the belt to that pair of
 * braces, and it also covers clients that ignore SameSite.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ].join("; ");
}
