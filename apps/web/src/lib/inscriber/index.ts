export {
  BURN_ADDRESS,
  COUNTERPARTY_BURN_ADDRESS,
  COUNTERPARTY_MARKER_OP_RETURN,
  COMMIT_TX_VSIZE,
  MAX_RECOMMENDED_REVEAL_WEIGHT,
  MAX_STANDARD_TX_WEIGHT,
  NETWORK,
  P2PKH_DUST_SATS,
  RBF_SEQUENCE,
  REVEAL_FEE_PADDING_BPS,
  STANDARD_REVEAL_WEIGHT_HEADROOM,
} from '@/lib/inscriber/constants'

export {
  hexCodec,
  prepareCommit,
  addressToScriptPubKey,
  pubkeyToP2wpkhAddress,
  buildCommitFundingPsbt,
  buildRevealPsbt,
  estimateRevealWeight,
  signPsbtInput,
  finalizeSignedPsbt,
  txidFromRawTx,
} from '@/lib/inscriber/transactions'

export {
  prepareBrandInscriptionPsbt,
  prepareArtistInscriptionPsbt,
  prepareCollectionInscriptionPsbt,
  prepareArtworkInscriptionPsbt,
  estimateArtworkInscriptionRevealWeight,
} from '@/lib/inscriber/inscriber'

export {
  CP_ISSUANCE_ID,
  nameToAssetId,
} from '@/lib/inscriber/counterparty'

export {
  COUNTERPARTY_SAFE_MIME_TYPES,
  TEXTUAL_APPLICATION_MIME_TYPES,
  baseMimeType,
  classifyCounterpartyMimeType,
  isCounterpartySafeMimeType,
  normalizeMimeType,
} from '@/lib/inscriber/mime'

export {
  MAX_COUNTERPARTY_COMPAT_PROPERTIES_BYTES,
  MAX_TITLE_LENGTH,
  MAX_TRAIT_FIELDS,
  MAX_TRAIT_VALUE_LENGTH,
  RESERVED_TRAIT_KEYS,
  TRAIT_KEY_PATTERN,
  buildTraitFields,
  normalizeTraitKey,
  validateInscriptionProperties,
} from '@/lib/inscriber/metadata'

export type {
  CounterpartyContentKind,
} from '@/lib/inscriber/mime'

export type {
  MetadataField,
  TraitFieldsResult,
} from '@/lib/inscriber/metadata'

export type {
  InscriptionData,
  InscriptionProperties,
  CounterpartyMetadataMode,
  ParentUtxo,
  PrepareResult,
  RevealPsbtResult,
  RevealWeightEstimate,
  FundingUtxo,
  CommitFundingPsbtResult,
  BrandInscriptionParams,
  ArtistInscriptionParams,
  CollectionInscriptionParams,
  ArtworkInscriptionParams,
  PreparedInscriptionCommit,
} from '@/lib/inscriber/types'
