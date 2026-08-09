export interface InscriptionData {
  contentType: string
  body: Uint8Array
  parentInscriptionId?: string
  metadata?: Record<string, unknown>
  /** Ordinals properties (tag 17): structured attributes/traits. */
  properties?: InscriptionProperties
  /** Metaprotocol identifier (tag 7), e.g. "xcp" for Counterparty. */
  metaprotocol?: string
}

export type CounterpartyMetadataMode = 'legacy-array' | 'xcp-map'

/** Properties per Ordinals spec (tag 17), CBOR with integer keys. */
export interface InscriptionProperties {
  title?: string
  traits?: Record<string, string | number | boolean | null>
}

export interface ParentUtxo {
  txid: string
  vout: number
  value: number
  scriptPubKey: Uint8Array
}

export interface PreparedInscriptionCommit {
  commitAddress: string
  commitAmount: number
  revealScript: Uint8Array
  tapInternalKey: Uint8Array
  revealWeight: RevealWeightEstimate
  revealBaseFee: number
  revealFeePadding: number
  revealFundedFee: number
}

export type PrepareResult = PreparedInscriptionCommit

export interface RevealWeightEstimate {
  scriptSize: number
  weight: number
  vsize: number
  maxRecommendedWeight: number
  remainingWeight: number
}

export interface RevealPsbtResult {
  psbtHex: string
  estimatedFee: number
  markerOutputIndex: 0
  inscriptionOutputIndex: 1
  parentReturnOutputIndex?: 2
}

export interface FundingUtxo {
  txid: string
  vout: number
  value: number
  scriptPubKey: Uint8Array
}

export interface CommitFundingPsbtResult {
  psbtHex: string
  inputValue: number
  commitAmount: number
  estimatedFee: number
  changeAmount: number
}

export interface ArtistInscriptionParams {
  name: string
  bio?: string
  twitter?: string
  website?: string
  metadata?: Record<string, unknown>
  traits?: Record<string, string | number | boolean | null>
  brandInscriptionId: string
  feeRate: number
}

export interface CollectionInscriptionParams {
  name: string
  description?: string
  metadata?: Record<string, unknown>
  traits?: Record<string, string | number | boolean | null>
  artistInscriptionId: string
  feeRate: number
}

export interface BrandInscriptionParams {
  name: string
  metadata?: Record<string, unknown>
  rootInscriptionId: string
  feeRate: number
}

export interface ArtworkInscriptionParams {
  asset: string
  quantity: number
  divisible: boolean
  lock: boolean
  imageData: Uint8Array
  mimeType: string
  parentInscriptionId?: string
  feeRate: number
  description?: string
  title?: string
  properties?: InscriptionProperties
  ordinalMetadata?: Record<string, unknown>
  counterpartyMetadataMode?: CounterpartyMetadataMode
}
