'use client'

import { useRef, useState } from 'react'
import { useWallet } from './wallet-context'
import { friendlyError, BTC_ADDRESS_REGEX } from './sdk'
import { COUNTERPARTY_API_BASE } from '@/utils/constants'

const UTXO_REGEX = /^[a-f0-9]{64}:\d+$/

export type ComposeStatus = 'idle' | 'composing' | 'signing' | 'broadcasting' | 'confirmed' | 'error'

export type ComposeState =
  | { status: 'idle'; txid: null; error: null }
  | { status: 'composing'; txid: null; error: null }
  | { status: 'signing'; txid: null; error: null }
  | { status: 'broadcasting'; txid: null; error: null }
  | { status: 'confirmed'; txid: string; error: null }
  | { status: 'error'; txid: null; error: string }

const INITIAL_STATE: ComposeState = { status: 'idle', txid: null, error: null }

/** Fetch next-block median fee rate from mempool.space (cached 30s).
 *  Exported so surfaces can show the rate a compose will actually pay. */
let cachedFeeRate: number | null = null
let feeRateTimestamp = 0

export async function fetchMedianFeeRate(): Promise<number> {
  const now = Date.now()
  if (cachedFeeRate && now - feeRateTimestamp < 30_000) return cachedFeeRate
  try {
    const res = await fetch('https://mempool.space/api/v1/fees/mempool-blocks')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { medianFee: number }[] = await res.json()
    cachedFeeRate = Math.max(Math.round(data[0]?.medianFee ?? 3), 1)
    feeRateTimestamp = now
    return cachedFeeRate
  } catch {
    return cachedFeeRate ?? 3
  }
}

let cachedFastFee: number | null = null
let fastFeeTimestamp = 0

/**
 * mempool.space's next-block estimate (fastestFee), for transactions that
 * MUST confirm promptly — e.g. a launch scheduled with a tight
 * pre-announcement lead, where confirming after start_block would open the
 * mint instantly and fail the standard. Degrades to median + a bump.
 */
export async function fetchPriorityFeeRate(): Promise<number> {
  const now = Date.now()
  if (cachedFastFee && now - fastFeeTimestamp < 30_000) return cachedFastFee
  try {
    const res = await fetch('https://mempool.space/api/v1/fees/recommended')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { fastestFee: number } = await res.json()
    cachedFastFee = Math.max(Math.round(data.fastestFee ?? 0), 1)
    fastFeeTimestamp = now
    return cachedFastFee
  } catch {
    return (await fetchMedianFeeRate()) + 2
  }
}

/** Call Counterparty compose endpoint */
async function composeRequest(
  path: string,
  type: string,
  params: Record<string, string | number>,
  extraParams?: Record<string, string>,
  feeRateOverride?: number,
): Promise<string> {
  const feeRate = feeRateOverride ?? (await fetchMedianFeeRate())
  const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    qp.set(k, String(v))
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) qp.set(k, v)
  }
  qp.set('sat_per_vbyte', String(feeRate))
  qp.set('verbose', 'true')

  const url = `${COUNTERPARTY_API_BASE}/${path}/compose/${type}?${qp.toString()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const data = await res.json()

  if (!res.ok || data.error) {
    throw new Error(data.error || `Compose failed: ${res.status}`)
  }

  return data.result.rawtransaction
}

export function useCompose() {
  const { address, signTransaction, broadcastTransaction } = useWallet()
  const [state, setState] = useState<ComposeState>(INITIAL_STATE)
  const busyRef = useRef(false)

  /** Compose → sign → broadcast pipeline */
  const run = async (expectedAddress: string, getUnsignedHex: () => Promise<string>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true

    try {
      setState({ status: 'composing', txid: null, error: null })
      const unsignedHex = await getUnsignedHex()

      setState({ status: 'signing', txid: null, error: null })
      const signedHex = await signTransaction(unsignedHex)

      setState({ status: 'broadcasting', txid: null, error: null })
      const txid = await broadcastTransaction(signedHex)

      setState({ status: 'confirmed', txid, error: null })
    } catch (e) {
      setState({ status: 'error', txid: null, error: friendlyError(e) })
    } finally {
      busyRef.current = false
    }
  }

  const execute = (
    type: string,
    params: Record<string, string | number>,
    feeRateOverride?: number,
  ): void => {
    if (!address) {
      setState({ status: 'error', txid: null, error: 'Wallet not connected' })
      return
    }
    if (!BTC_ADDRESS_REGEX.test(address)) {
      setState({ status: 'error', txid: null, error: 'Invalid wallet address' })
      return
    }
    run(address, () =>
      composeRequest(
        `addresses/${address}`,
        type,
        params,
        { exclude_utxos_with_balances: 'true' },
        feeRateOverride,
      ),
    )
  }

  const executeUtxo = (utxo: string, type: string, params: Record<string, string | number>): void => {
    if (!address) {
      setState({ status: 'error', txid: null, error: 'Wallet not connected' })
      return
    }
    if (!UTXO_REGEX.test(utxo)) {
      setState({ status: 'error', txid: null, error: 'Invalid UTXO format' })
      return
    }
    run(address, () => composeRequest(`utxos/${utxo}`, type, params))
  }

  const composeOrder = (params: {
    give_asset: string
    give_quantity: number
    get_asset: string
    get_quantity: number
    expiration?: number
    /** sat/vB override; defaults to the next-block median at compose time. */
    fee_rate?: number
  }) => execute('order', {
    give_asset: params.give_asset,
    give_quantity: params.give_quantity,
    get_asset: params.get_asset,
    get_quantity: params.get_quantity,
    expiration: params.expiration ?? 5000,
    fee_required: 0,
  }, params.fee_rate)

  const composeDispenser = (params: {
    asset: string
    give_quantity: number
    escrow_quantity: number
    mainchainrate: number
    status?: number
  }) => execute('dispenser', {
    asset: params.asset,
    give_quantity: params.give_quantity,
    escrow_quantity: params.escrow_quantity,
    mainchainrate: params.mainchainrate,
    status: params.status ?? 0,
  })

  const composeDispense = (params: {
    dispenser: string
    quantity: number
  }) => execute('dispense', {
    dispenser: params.dispenser,
    quantity: params.quantity,
  })

  const composeAttach = (params: {
    asset: string
    quantity: number
  }) => execute('attach', {
    asset: params.asset,
    quantity: params.quantity,
  })

  const composePoolDeposit = (params: {
    asset_a: string
    asset_b: string
    quantity_a: number
    quantity_b: number
    min_lp_quantity?: number
    lp_asset?: string
    /** sat/vB override; defaults to the next-block median at compose time. */
    fee_rate?: number
  }) => execute('pooldeposit', {
    asset_a: params.asset_a,
    asset_b: params.asset_b,
    quantity_a: params.quantity_a,
    quantity_b: params.quantity_b,
    min_lp_quantity: params.min_lp_quantity ?? 0,
    ...(params.lp_asset ? { lp_asset: params.lp_asset } : {}),
  }, params.fee_rate)

  const composePoolWithdraw = (params: {
    lp_asset: string
    quantity: number
    min_quantity_a?: number
    min_quantity_b?: number
    /** sat/vB override; defaults to the next-block median at compose time. */
    fee_rate?: number
  }) => execute('poolwithdraw', {
    lp_asset: params.lp_asset,
    quantity: params.quantity,
    min_quantity_a: params.min_quantity_a ?? 0,
    min_quantity_b: params.min_quantity_b ?? 0,
  }, params.fee_rate)

  const composeDetach = (utxo: string) => executeUtxo(utxo, 'detach', {})

  /** Cancel an open DEX order by its transaction hash. */
  const composeCancel = (params: { offer_hash: string }) =>
    execute('cancel', { offer_hash: params.offer_hash })

  /**
   * Open an XCP-69 fairminter. All values raw satoshi units.
   * start_block must be in the future (the pre-announcement window); the
   * compose API itself rejects a start at or below the current block.
   * Pass fee_rate (e.g. fetchPriorityFeeRate()) for tight leads where the
   * launch must confirm well before its start block.
   */
  const composeFairminter = (params: {
    asset: string
    price: number
    quantity_by_price: number
    hard_cap: number
    soft_cap: number
    start_block: number
    soft_cap_deadline_block: number
    max_mint_per_tx: number
    max_mint_per_address: number
    pool_quantity: number
    lp_asset: string
    description: string
    fee_rate?: number
  }) => execute('fairminter', {
    asset: params.asset,
    price: params.price,
    quantity_by_price: params.quantity_by_price,
    hard_cap: params.hard_cap,
    soft_cap: params.soft_cap,
    start_block: params.start_block,
    soft_cap_deadline_block: params.soft_cap_deadline_block,
    max_mint_per_tx: params.max_mint_per_tx,
    max_mint_per_address: params.max_mint_per_address,
    pool_quantity: params.pool_quantity,
    lp_asset: params.lp_asset,
    description: params.description,
    premint_quantity: 0,
    minted_asset_commission: 0,
    burn_payment: 'false',
    lock_description: 'true',
    lock_quantity: 'true',
    divisible: 'true',
    end_block: 0,
  }, params.fee_rate)

  /** Mint from a fairminter; quantity is raw earn units (whole lots). */
  const composeFairmint = (params: { asset: string; quantity: number }) =>
    execute('fairmint', {
      asset: params.asset,
      quantity: params.quantity,
    })

  const reset = () => setState(INITIAL_STATE)

  return {
    ...state,
    composeOrder,
    composeDispenser,
    composeDispense,
    composeAttach,
    composePoolDeposit,
    composePoolWithdraw,
    composeDetach,
    composeCancel,
    composeFairminter,
    composeFairmint,
    reset,
  }
}
