import { secp256k1 } from "@noble/curves/secp256k1";
import { p2pkh } from "@scure/btc-signer";
import { createProofMessage, legacyMessageHash } from "@xcp/wallet-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/session/route";
import { issueSession, readSession, readSessionDetails, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

const config = vi.hoisted(() => ({ secret: "session-test-secret-not-for-production" as string | undefined }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { SESSION_SECRET: config.secret } }),
}));

const NOW = 1_800_000_000;
const ORIGIN = "https://xcp.fun";
const PRIVATE_KEY = new Uint8Array(32).fill(7);
const ADDRESS = p2pkh(secp256k1.getPublicKey(PRIVATE_KEY, true)).address!;

beforeEach(() => {
  config.secret = "session-test-secret-not-for-production";
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

async function signedPayload(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return `${payload.toString("base64url")}.${Buffer.from(signature).toString("base64url")}`;
}

function proof(options: { origin?: string; issued?: number } = {}) {
  const message = createProofMessage({ origin: options.origin ?? ORIGIN,
    issued: options.issued ?? NOW, nonce: "session-test-nonce" });
  const signature = secp256k1.sign(legacyMessageHash(message), PRIVATE_KEY, { prehash: false, lowS: true });
  return { address: ADDRESS, message,
    signature: Buffer.from([31 + signature.recovery!, ...signature.toCompactRawBytes()]).toString("base64"),
    verification: { method: "BIP-137" as const, format: "legacy_recoverable" as const } };
}

function request(method: string, options: { token?: string; body?: unknown; origin?: string } = {}) {
  return new Request(`${ORIGIN}/api/session`, { method, headers: {
    ...(options.origin !== "" ? { origin: options.origin ?? ORIGIN } : {}),
    ...(options.token ? { cookie: `${SESSION_COOKIE}=${options.token}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
  }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
}

describe("signed address sessions", () => {
  it("returns the signed identity and exact expiry, expiring at the boundary second", async () => {
    const token = await issueSession(ADDRESS);
    expect(await readSessionDetails(token)).toEqual({ address: ADDRESS, expiresAt: NOW + SESSION_TTL_SECONDS });
    expect(await readSession(token)).toBe(ADDRESS);
    vi.setSystemTime((NOW + SESSION_TTL_SECONDS) * 1000 - 1);
    expect(await readSession(token)).toBe(ADDRESS);
    vi.setSystemTime((NOW + SESSION_TTL_SECONDS) * 1000);
    expect(await readSession(token)).toBeNull();
  });

  it("rejects tampering and extra token segments", async () => {
    const token = await issueSession(ADDRESS);
    const [payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ a: "another-address", e: NOW + 100 })).toString("base64url");
    const forgedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    for (const candidate of [undefined, "", "broken", ".broken", "broken.", "?.?", "A.A",
      `${token}.extra`, `${forgedPayload}.${signature}`, `${payload}.${forgedSignature}`, "A".repeat(4097)]) {
      expect(await readSessionDetails(candidate)).toBeNull();
    }
  });

  it.each([
    { a: ADDRESS, e: NOW }, { a: ADDRESS, e: NOW + 0.5 }, { a: ADDRESS, e: `${NOW + 100}` },
    { a: "", e: NOW + 100 }, { a: 123, e: NOW + 100 }, { a: ADDRESS }, null,
  ])("rejects invalid fields even in a correctly signed payload: %j", async (payload) => {
    expect(await readSessionDetails(await signedPayload(payload))).toBeNull();
  });

  it("fails closed if its signing secret is missing or changes", async () => {
    const token = await issueSession(ADDRESS);
    config.secret = "different-secret";
    expect(await readSession(token)).toBeNull();
    config.secret = undefined;
    expect(await readSession(token)).toBeNull();
    await expect(issueSession(ADDRESS)).rejects.toThrow("SESSION_SECRET");
  });
});

describe("session route", () => {
  it("restores a valid cookie without a new proof and forbids response caching", async () => {
    const token = await issueSession(ADDRESS);
    // A standard same-origin GET need not send an Origin header.
    const response = await GET(request("GET", { token, origin: "" }));
    expect(await response.json()).toEqual({ address: ADDRESS, expires_at: NOW + SESSION_TTL_SECONDS,
      expires_in: SESSION_TTL_SECONDS });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("does not restore from an unsigned address, a bad cookie or an expired cookie", async () => {
    for (const token of [undefined, "forged.cookie", await signedPayload({ a: ADDRESS, e: NOW })]) {
      const response = await GET(new Request(`${ORIGIN}/api/session?address=${ADDRESS}`, {
        headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
      }));
      expect(await response.json()).toEqual({ address: null, expires_at: null, expires_in: 0 });
    }
  });

  it("exchanges an actual cryptographically valid proof and reports the cookie's signed expiry", async () => {
    const response = await POST(request("POST", { body: { proof: proof() } }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Strict");
    const token = cookie.split(";")[0].slice(SESSION_COOKIE.length + 1);
    expect(await readSessionDetails(token)).toEqual({ address: ADDRESS, expiresAt: NOW + SESSION_TTL_SECONDS });
    expect(await response.json()).toEqual({ address: ADDRESS, expires_at: NOW + SESSION_TTL_SECONDS,
      expires_in: SESSION_TTL_SECONDS });
  });

  it("preserves proof freshness, origin, signature and declared-dialect verification", async () => {
    const valid = proof();
    for (const invalid of [proof({ issued: NOW - 301 }), proof({ issued: NOW + 31 }),
      proof({ origin: "https://other.example" }), { ...valid, address: "claimed-address" },
      { ...valid, signature: "not-a-signature" }, { ...valid, verification: { method: "BIP-322", format: "" } }]) {
      const response = await POST(request("POST", { body: { proof: invalid } }));
      expect(response.status).toBe(401);
      expect(response.headers.has("set-cookie")).toBe(false);
    }
  });

  it("refuses cross-origin session writes and clears with the same cookie attributes", async () => {
    for (const origin of ["", "https://attacker.example"]) {
      expect((await POST(request("POST", { origin, body: { proof: proof() } }))).status).toBe(403);
      expect((await DELETE(request("DELETE", { origin }))).status).toBe(403);
    }
    const response = await DELETE(request("DELETE"));
    expect(response.headers.get("set-cookie")).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
