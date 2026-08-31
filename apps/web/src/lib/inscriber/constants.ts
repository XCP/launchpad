import * as btc from '@scure/btc-signer'
import { hex } from '@scure/base'
import { COUNTERPARTY_BURN_ADDRESS } from '@/lib/constants'

export const NETWORK = btc.NETWORK
export const P2PKH_DUST_SATS = 546
export const COUNTERPARTY_MARKER_OP_RETURN = hex.decode('6a08434e545250525459')
export const MAX_STANDARD_TX_WEIGHT = 400_000
export const STANDARD_REVEAL_WEIGHT_HEADROOM = 2_000
export const MAX_RECOMMENDED_REVEAL_WEIGHT = MAX_STANDARD_TX_WEIGHT - STANDARD_REVEAL_WEIGHT_HEADROOM
export const RBF_SEQUENCE = 0xfffffffd
export const COMMIT_TX_VSIZE = 160
export const REVEAL_FEE_PADDING_BPS = 1_000

export { COUNTERPARTY_BURN_ADDRESS }

/** Backward-compatible alias for current app code. */
export const BURN_ADDRESS = COUNTERPARTY_BURN_ADDRESS
