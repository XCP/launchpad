import type { ArtworkInscriptionParams } from '@/lib/inscriber/types'

export const CP_ISSUANCE_ID = 20

export function nameToAssetId(name: string): bigint {
  if (!/^[A-Z]{4,12}$/.test(name)) {
    throw new Error('Counterparty asset names must be 4-12 uppercase letters')
  }

  let id = BigInt(0)
  for (const char of name) id = id * BigInt(26) + BigInt(char.charCodeAt(0) - 65)
  return id
}

export function buildIssuanceMetadata(params: ArtworkInscriptionParams): Record<string, unknown> {
  const cpMetadata: unknown[] = [
    CP_ISSUANCE_ID,
    nameToAssetId(params.asset),
    params.quantity,
    params.divisible,
    params.lock,
    false,
  ]

  if (params.counterpartyMetadataMode === 'legacy-array') {
    return cpMetadata as unknown as Record<string, unknown>
  }

  return {
    ...params.ordinalMetadata,
    name: params.title || params.asset,
    asset: params.asset,
    ...(params.description && { description: params.description }),
    xcp: cpMetadata,
  }
}
