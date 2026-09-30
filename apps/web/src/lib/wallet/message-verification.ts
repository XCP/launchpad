import type { ConnectionProof } from "@xcp/wallet-sdk";

/**
 * The dialect to declare for a message the connected wallet just signed. The
 * connection proof is the wallet's own statement of how it signs messages for
 * this address: XCP Wallet 0.14 labels legacy (P2PKH) proofs
 * `{ method: "BIP-137", format: "legacy_recoverable" }` and older versions
 * `{ method: "BIP-322", format: "p2pkh" }`, a Trezor account says BIP-137 on
 * every address type, and Horizon says BIP-137 too. The session's
 * `messageVerification` only knows what a wallet kind declares up front
 * (Horizon), so it is the fallback when no proof speaks for this address.
 *
 * The server decides validity by the address check either way; on a P2PKH
 * address it accepts the classic signature and the two-item BIP-322 stack
 * whatever this says.
 */
export function messageVerificationFor(
  address: string,
  connectionProof: ConnectionProof | null | undefined,
  sessionVerification: ConnectionProof["verification"],
): ConnectionProof["verification"] {
  if (connectionProof?.address === address && connectionProof.verification) return connectionProof.verification;
  return sessionVerification;
}
