import { buildIssuanceMetadata } from '@/lib/inscriber/counterparty'
import { buildInscriptionScript } from '@/lib/inscriber/ordinals'
import { estimateRevealWeight, prepareCommit } from '@/lib/inscriber/transactions'
import type {
  ArtistInscriptionParams,
  ArtworkInscriptionParams,
  BrandInscriptionParams,
  CollectionInscriptionParams,
  InscriptionData,
  InscriptionProperties,
  PreparedInscriptionCommit,
  RevealWeightEstimate,
} from '@/lib/inscriber/types'

const ESTIMATE_PUBKEY = new Uint8Array(32)

function makeArtistInscriptionData(params: ArtistInscriptionParams): InscriptionData {
  const meta: Record<string, unknown> = { name: params.name }
  if (params.bio) meta.bio = params.bio
  if (params.twitter) meta.twitter = params.twitter
  if (params.website) meta.website = params.website
  if (params.metadata) Object.assign(meta, params.metadata)

  const properties: InscriptionProperties = {
    title: params.name,
    traits: {
      type: 'artist',
      platform: 'artifact',
      ...(params.twitter && { twitter: params.twitter }),
      ...(params.website && { website: params.website }),
      ...params.traits,
    },
  }

  return {
    contentType: 'text/plain',
    body: new TextEncoder().encode(params.name),
    parentInscriptionId: params.brandInscriptionId,
    metadata: meta,
    properties,
  }
}

function makeCollectionInscriptionData(params: CollectionInscriptionParams): InscriptionData {
  const meta: Record<string, unknown> = { name: params.name }
  if (params.description) meta.description = params.description
  if (params.metadata) Object.assign(meta, params.metadata)

  const properties: InscriptionProperties = {
    title: params.name,
    traits: {
      type: 'collection',
      platform: 'artifact',
      ...(params.description && { description: params.description }),
      ...params.traits,
    },
  }

  return {
    contentType: 'text/plain',
    body: new TextEncoder().encode(params.name),
    parentInscriptionId: params.artistInscriptionId,
    metadata: meta,
    properties,
  }
}

function makeBrandInscriptionData(params: BrandInscriptionParams): InscriptionData {
  return {
    contentType: 'application/json',
    body: new TextEncoder().encode(JSON.stringify({ name: params.name, ...params.metadata })),
    parentInscriptionId: params.rootInscriptionId,
    metadata: params.metadata,
  }
}

function makeArtworkInscriptionData(params: ArtworkInscriptionParams): InscriptionData {
  return {
    contentType: params.mimeType,
    body: params.imageData,
    parentInscriptionId: params.parentInscriptionId,
    metaprotocol: 'xcp',
    properties: params.properties,
    metadata: buildIssuanceMetadata(params),
  }
}

export function prepareArtistInscriptionPsbt(
  params: ArtistInscriptionParams,
  pubkey: Uint8Array,
): PreparedInscriptionCommit {
  return prepareCommit(pubkey, makeArtistInscriptionData(params), params.feeRate)
}

export function prepareCollectionInscriptionPsbt(
  params: CollectionInscriptionParams,
  pubkey: Uint8Array,
): PreparedInscriptionCommit {
  return prepareCommit(pubkey, makeCollectionInscriptionData(params), params.feeRate)
}

export function prepareBrandInscriptionPsbt(
  params: BrandInscriptionParams,
  pubkey: Uint8Array,
): PreparedInscriptionCommit {
  return prepareCommit(pubkey, makeBrandInscriptionData(params), params.feeRate)
}

export function prepareArtworkInscriptionPsbt(
  params: ArtworkInscriptionParams,
  pubkey: Uint8Array,
): PreparedInscriptionCommit {
  return prepareCommit(pubkey, makeArtworkInscriptionData(params), params.feeRate)
}

export function estimateArtworkInscriptionRevealWeight(
  params: ArtworkInscriptionParams,
  pubkey: Uint8Array = ESTIMATE_PUBKEY,
): RevealWeightEstimate {
  const data = makeArtworkInscriptionData(params)
  const script = buildInscriptionScript(pubkey, data)
  return estimateRevealWeight(script.length, !!data.parentInscriptionId)
}
