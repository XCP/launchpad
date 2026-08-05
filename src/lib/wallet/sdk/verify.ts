import type { ConnectionProof } from './types'

const PROOF_PREFIX = 'xcp-wallet'
const MAX_AGE_SECONDS = 300 // 5 minutes

/** Parsed fields from a connection proof message */
export interface ParsedProof {
  origin: string
  nonce: string
  issued: number
}

/** Parse the fields from a connection proof message. Returns null if format is invalid. */
export function parseProofMessage(message: string): ParsedProof | null {
  const lines = message.split('\n')
  if (lines[0] !== PROOF_PREFIX) return null

  const fields: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':')
    if (colon === -1) return null
    fields[lines[i].slice(0, colon)] = lines[i].slice(colon + 1)
  }

  const origin = fields['origin']
  const nonce = fields['nonce']
  const issued = parseInt(fields['issued'], 10)

  if (!origin || !nonce || isNaN(issued)) return null
  return { origin, nonce, issued }
}

/**
 * Validate a connection proof — checks message format, origin, timestamp, and address.
 *
 * If a `verifySignature` function is provided (server-side), it also verifies
 * the cryptographic signature. Otherwise only structural checks are performed.
 *
 * @example Client-side (no crypto):
 * ```ts
 * const result = await validateProof(proof, 'https://xcpdex.com', address)
 * ```
 *
 * @example Server-side (with BIP-322 verification):
 * ```ts
 * const result = await validateProof(proof, origin, address, {
 *   verifySignature: (message, signature, address) => verifyBIP322(message, signature, address)
 * })
 * ```
 */
export async function validateProof(
  proof: ConnectionProof,
  expectedOrigin: string,
  expectedAddress: string,
  options: {
    maxAgeSeconds?: number
    verifySignature?: (message: string, signature: string, address: string) => Promise<boolean>
  } = {},
): Promise<{ valid: boolean; reason?: string }> {
  const { maxAgeSeconds = MAX_AGE_SECONDS, verifySignature } = options

  const parsed = parseProofMessage(proof.message)
  if (!parsed) return { valid: false, reason: 'Invalid proof message format' }

  if (parsed.origin !== expectedOrigin)
    return { valid: false, reason: `Origin mismatch: expected ${expectedOrigin}, got ${parsed.origin}` }

  const age = Math.floor(Date.now() / 1000) - parsed.issued
  if (age < -30) return { valid: false, reason: 'Proof timestamp is in the future' }
  if (age > maxAgeSeconds) return { valid: false, reason: `Proof expired (${age}s old, max ${maxAgeSeconds}s)` }

  if (proof.address !== expectedAddress)
    return { valid: false, reason: 'Proof address does not match expected address' }

  // Cryptographic verification (optional — requires server-side crypto)
  if (verifySignature) {
    try {
      const sigValid = await verifySignature(proof.message, proof.signature, proof.address)
      if (!sigValid) return { valid: false, reason: 'Signature verification failed' }
    } catch (e) {
      return { valid: false, reason: `Signature verification error: ${e instanceof Error ? e.message : 'unknown'}` }
    }
  }

  return { valid: true }
}
