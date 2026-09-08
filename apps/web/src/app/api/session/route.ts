import { NextResponse } from "next/server";
import { BodyTooLarge, boundedJson } from "@/lib/bounded-body";
import {
  validateProof,
  verifyDeclaredConnectionSignature,
} from "@xcp/wallet-sdk";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  issueSession,
  readCookie,
  readSessionDetails,
  sameOrigin,
  sessionCookie,
} from "@/lib/session";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Cookie" };
// A connection proof is small; allow 64 KiB for supported wallet formats.
const MAX_PROOF_BODY_BYTES = 64 * 1024;

/** Restore only the identity attested by a currently valid HttpOnly cookie. */
export async function GET(request: Request) {
  const session = await readSessionDetails(readCookie(request, SESSION_COOKIE));
  return NextResponse.json(
    {
      address: session?.address ?? null,
      expires_at: session?.expiresAt ?? null,
      expires_in: session ? session.expiresAt - Math.floor(Date.now() / 1000) : 0,
    },
    { headers: PRIVATE_HEADERS },
  );
}

/**
 * Exchange a wallet connection proof for a session.
 *
 * The proof is checked with the SAME validateProof the client uses, given a
 * real verifySignature this time — client-side verification runs in the page
 * that received the proof and so can never be the security boundary; this is.
 * Origin and a five-minute freshness window come from the proof's own signed
 * message, so a proof minted for another site, or an old one, is refused.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }

  let proof: {
    address?: unknown;
    message?: unknown;
    signature?: unknown;
    verification?:
      | { method: "BIP-322"; format: string }
      | { method: "BIP-137"; format: "legacy_recoverable" };
  };
  try {
    proof = ((await boundedJson(request, MAX_PROOF_BODY_BYTES)) as { proof?: typeof proof }).proof ?? {};
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const { address, message, signature, verification } = proof;
  if (
    typeof address !== "string" ||
    typeof message !== "string" ||
    typeof signature !== "string"
  ) {
    return NextResponse.json({ error: "Incomplete proof" }, { status: 400 });
  }

  const result = await validateProof(
    // The wallet passes `verification.format` along so a caller doesn't have
    // to work out the script type; carried through as sent. verifyBip322
    // happens not to need it — a Bitcoin address encodes its own script type,
    // and decoding it is the same step that produces the scriptPubKey.
    {
      address,
      message,
      signature,
      verification: verification ?? { method: "BIP-322", format: "" },
    },
    new URL(request.url).origin,
    address,
    {
      verifySignature: async (msg, sig, addr) => {
        try {
          // A Horizon proof is BIP-137 and says so; an XCP Wallet proof is BIP-322.
          return verifyDeclaredConnectionSignature(
            { address, message, signature, verification: verification ?? { method: "BIP-322", format: "" } },
            msg,
            sig,
            addr,
          );
        } catch {
          // An address type we can't check is a refusal, not a pass: this is
          // the boundary, so "unknown" has to fail closed.
          return false;
        }
      },
    },
  );
  if (!result.valid) {
    return NextResponse.json({ error: result.reason ?? "Invalid proof" }, { status: 401 });
  }

  let token: string;
  try {
    token = await issueSession(address);
  } catch {
    // No SESSION_SECRET configured — callers fall back to signing each write.
    return NextResponse.json({ error: "Sessions unavailable" }, { status: 503 });
  }

  const session = await readSessionDetails(token);
  if (!session) {
    return NextResponse.json({ error: "Sessions unavailable" }, { status: 503 });
  }
  return NextResponse.json(
    { address, expires_at: session.expiresAt, expires_in: session.expiresAt - Math.floor(Date.now() / 1000) },
    { headers: { ...PRIVATE_HEADERS, "set-cookie": sessionCookie(token, SESSION_TTL_SECONDS) } },
  );
}

/** Sign out. Clearing the cookie is all a stateless session can be. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
  return NextResponse.json(
    { ok: true },
    { headers: { ...PRIVATE_HEADERS, "set-cookie": sessionCookie("", 0) } },
  );
}
