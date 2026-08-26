'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from './wallet-context'
import { friendlyError, BTC_ADDRESS_REGEX } from './sdk'
import { parseTxInputs, type TxInput } from './raw-tx'
import { msSinceLastSpend, recentlySpentUtxos, registerSpentUtxos } from './spent-utxos'
import { pubkeyFromBip322 } from '@/lib/bip322'
import { quantityParam } from '@/lib/numeric'
import { COUNTERPARTY_API_BASE } from '@/lib/constants'
import { relayingFetch } from '@/lib/counterparty-relay'

/** A compose parameter value; bigint/string carry quantities beyond 2^53. */
type ComposeValue = string | number | bigint

/** A caller-supplied quantity; numbers past 2^53 are refused, not rounded. */
type Quantity = number | bigint

const UTXO_REGEX = /^[a-f0-9]{64}:\d+$/

/** friendlyError's catch-all — the one message that says nothing at all. */
const GENERIC_ERROR = 'Something went wrong — please try again'

/**
 * Core reports compose failures as a Python repr of a list, even for one
 * error: `['insufficient XCP balance to pay fee', 'lp_asset must be a
 * numeric asset']`. Unwrapped into `a; b`, because the brackets and quotes
 * are noise and — more importantly — because the SECOND error is the one
 * that usually explains the failure. Anything that isn't that shape is
 * returned unchanged.
 */
function normalizeCoreError(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map(String).join('; ')
  const text = typeof raw === 'string' ? raw.trim() : ''
  const list = /^\[(.*)\]$/s.exec(text)
  if (!list) return text
  // An empty list carries no information; let the caller's fallback speak.
  if (list[1]!.trim() === '') return ''
  const parts = [...list[1]!.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map(
    (m) => (m[1] ?? m[2] ?? '').replace(/\\(['"\\])/g, '$1'),
  )
  return parts.length > 0 ? parts.join('; ') : text
}

/**
 * The friendly message when one fits, the REAL one when none does.
 *
 * friendlyError's fallback is a dead end: it tells a user nothing and leaves
 * the only copy of the reason in a console.warn, which is no use at all to
 * someone who hit this on a launch and doesn't have devtools open. Core's
 * compose errors are specific and actionable — "start_block must be greater
 * than the current block", "lp_asset must be a numeric asset" — and an
 * unrecognised error is exactly the case where raw text beats polish.
 *
 * Recognised errors keep their friendly wording; this only replaces the
 * catch-all. friendlyError still logs, so nothing stops being debuggable.
 */
function composeError(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).trim()

  // Preserve which balance is actually short. The shared wallet formatter's
  // generic `insufficient` branch used to flatten all three of these into
  // "Insufficient balance", sending users to refresh tokens when Core was
  // really asking for XCP or BTC.
  if (/rate limit|too many requests|(?:API error|HTTP)[: ]+429/i.test(raw)) {
    return 'Counterparty API is busy — wait a moment and try again.'
  }
  if (/insufficient XCP balance to pay fee/i.test(raw)) {
    return 'Not enough XCP to pay the Counterparty fee for this action.'
  }
  if (/insufficient funds for the target amount/i.test(raw)) {
    return 'Not enough spendable BTC for the transaction and miner fee. Wait for pending change to confirm or add BTC.'
  }

  // The one core error worth naming ourselves, because it is the first-timer
  // failure and its own words don't say what's missing. "no utxos found for
  // 1ABC…" contains none of friendlyError's keywords — not even
  // "insufficient" — so it fell all the way through to the catch-all, which
  // is how someone funded with XCP but no bitcoin got told nothing at all.
  // XCP pays Counterparty's fee; bitcoin pays the miners; a wallet holding
  // only the first cannot build a transaction.
  if (NO_SPENDABLE_BTC_PATTERN.test(raw)) {
    return 'No spendable bitcoin at this address — every transaction needs BTC for the miner fee, on top of any XCP it spends.'
  }

  // Core often names the asset and the required/available quantities in its
  // insufficiency text. That detail is the diagnosis; do not erase it.
  if (/insufficient/i.test(raw) && !/^insufficient balance$/i.test(raw)) return raw

  const friendly = friendlyError(e)
  if (friendly !== GENERIC_ERROR) return friendly

  return raw && raw !== '[object Object]' ? raw : friendly
}

export type ComposeStatus = 'idle' | 'composing' | 'signing' | 'broadcasting' | 'confirmed' | 'error'

export type ComposeState =
  | { status: 'idle'; txid: null; error: null }
  | { status: 'composing'; txid: null; error: null }
  | { status: 'signing'; txid: null; error: null }
  | { status: 'broadcasting'; txid: null; error: null }
  | { status: 'confirmed'; txid: string; error: null }
  | { status: 'error'; txid: null; error: string }

const INITIAL_STATE: ComposeState = { status: 'idle', txid: null, error: null }

// core's own error text (composer.py) for "the selected UTXOs don't cover
// this" — matched narrowly so this retry never masks a wallet that's
// actually empty, only the propagation-lag window right after our own
// broadcast (see spent-utxos.ts's msSinceLastSpend doc comment).
const INSUFFICIENT_UTXO_PATTERN = /insufficient funds for the target amount|no utxos found for/i
const UTXO_RACE_RETRY_WINDOW_MS = 8_000
const UTXO_RACE_RETRY_DELAY_MS = 2_000

// Core complaining about the UTXOs it selected itself — the shapes the wallet
// extension's own compose fallback matches on
// (core/counterparty/compose.ts::isUtxoError). Distinct from the "insufficient
// funds" race above: that one is a timing gap, this one is a selection core
// will keep making until it is told to stop looking at its mempool.
const STALE_UTXO_PATTERN = /invalid UTXOs|UTXO not found|transaction not found/i

// Core's way of saying the address has nothing to spend. Deliberately NOT
// matching "insufficient funds for the target amount", which is the race
// above and means the coins exist but aren't visible yet.
const NO_SPENDABLE_BTC_PATTERN = /no utxos found for|no unspent outputs/i

/** One bounded, invisible retry for the UTXO-propagation race: if we JUST
 *  broadcast something and the very next compose fails with exactly the
 *  "not enough" shape core raises when it can't cover the amount, wait a
 *  beat and try again once before surfacing anything to the user. Anything
 *  else — a different error, or a wallet that's simply been empty for
 *  longer than that window — passes straight through. */
async function withUtxoRaceRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const sinceSpend = msSinceLastSpend()
    if (
      INSUFFICIENT_UTXO_PATTERN.test(msg) &&
      sinceSpend !== null &&
      sinceSpend < UTXO_RACE_RETRY_WINDOW_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, UTXO_RACE_RETRY_DELAY_MS))
      return fn()
    }
    throw e
  }
}

/**
 * The floor every rate here is clamped to, in sat/vB.
 *
 * Bitcoin Core's default minrelaytxfee is 1000 sat/kvB — one satoshi per
 * vbyte — so a transaction priced under this is not slow, it simply does not
 * relay. mempool.space's precise estimates DO go below it (hourFee 0.571 and
 * economyFee 0.2 at the time of writing), which is honest about what would
 * confirm eventually and useless as something to broadcast.
 */
const MIN_RELAY_SAT_VB = 1

/** Fetch next-block median fee rate from mempool.space (cached 30s).
 *  Exported so surfaces can show the rate a compose will actually pay.
 *
 *  Fractional, not rounded. Counterparty accepts a fractional sat_per_vbyte
 *  and prices the transaction from it, so rounding 1.06 up to 1 sat/vB — or
 *  worse, 1.5 up to 2 — was paying for precision the estimate already had.
 *  Only the relay floor is applied. */
let cachedFeeRate: number | null = null
let feeRateTimestamp = 0

export async function fetchMedianFeeRate(): Promise<number> {
  const now = Date.now()
  if (cachedFeeRate && now - feeRateTimestamp < 30_000) return cachedFeeRate
  try {
    const res = await fetch('https://mempool.space/api/v1/fees/mempool-blocks')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { medianFee: number }[] = await res.json()
    cachedFeeRate = Math.max(data[0]?.medianFee ?? 3, MIN_RELAY_SAT_VB)
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
 *
 * /precise rather than /recommended: the two return the same shape, but
 * /recommended rounds UP to whole sat/vB. At a quiet moment that is the
 * difference between 1.562 and 2 — a third more fee for no more speed, on
 * exactly the transactions this function exists to price well.
 */
export async function fetchPriorityFeeRate(): Promise<number> {
  const now = Date.now()
  if (cachedFastFee && now - fastFeeTimestamp < 30_000) return cachedFastFee
  try {
    const res = await fetch('https://mempool.space/api/v1/fees/precise')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { fastestFee: number } = await res.json()
    cachedFastFee = Math.max(data.fastestFee ?? 0, MIN_RELAY_SAT_VB)
    fastFeeTimestamp = now
    return cachedFastFee
  } catch {
    return (await fetchMedianFeeRate()) + 2
  }
}

/**
 * Call Counterparty compose endpoint. Every quantity the user signs passes
 * through this loop, so serialization is gated by quantityParam: String() on
 * an unsafe double would put wrong digits (or exponent notation) into the
 * transaction. Non-numeric params are strings and pass through unchanged.
 */
async function composeRequest(
  path: string,
  type: string,
  params: Record<string, ComposeValue>,
  extraParams?: Record<string, string>,
  feeRateOverride?: number,
): Promise<string> {
  const feeRate = feeRateOverride ?? (await fetchMedianFeeRate())
  const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    try {
      qp.set(k, quantityParam(v))
    } catch (e) {
      throw new Error(
        `${k}: ${e instanceof Error ? e.message : 'unusable value'}`,
      )
    }
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) qp.set(k, v)
  }
  qp.set('sat_per_vbyte', String(feeRate))
  qp.set('verbose', 'true')

  const url = `${COUNTERPARTY_API_BASE}/${path}/compose/${type}?${qp.toString()}`
  // Through the relay, and essential: composing is the one call a user cannot
  // route around. When the node stops talking to a browser everything else
  // degrades to a stale number, but this degrades to "you cannot transact" --
  // so it is exempt from the budget that stands the pollers down.
  const res = await relayingFetch(url, 30_000, { essential: true })
  const body = await res.text()
  let data: { error?: unknown; result?: { rawtransaction?: string } } = {}
  try {
    data = body ? JSON.parse(body) : {}
  } catch {
    if (!res.ok) throw new Error(`Counterparty API request failed: HTTP ${res.status}`)
    throw new Error('Counterparty API returned an unreadable response')
  }

  if (res.status === 429) {
    throw new Error('Counterparty API rate limit: HTTP 429')
  }

  if (!res.ok || data.error) {
    throw new Error(normalizeCoreError(data.error) || `Compose failed: ${res.status}`)
  }

  if (!data.result?.rawtransaction) throw new Error('Compose response did not include a transaction')
  return data.result.rawtransaction
}

export function useCompose() {
  const { address, connectionProof, publicKey, signTransaction, broadcastTransaction } = useWallet()

  /**
   * The source's public key, for the compose calls that need one.
   *
   * Counterparty encodes any message over 80 bytes as bare multisig, and a
   * multisig output embeds the source's pubkey so the source can recover its
   * own dust. Core finds that key by scanning the address's transactions,
   * which only works after the address has SPENT — the first moment a key
   * appears on chain. A freshly funded wallet has never spent, so every
   * launch from one failed on "Pubkey not found for …, please provide it
   * with the `multisig_pubkey` parameter" — a first-run failure that hit
   * exactly the people least equipped to read it.
   *
   * Two sources, in this order:
   *
   *  1. The wallet, via xcp_getAddresses. Authoritative, needs no signature,
   *     and covers TAPROOT — which the second source cannot, since a p2tr
   *     address commits to the tweaked output key while the signable one is
   *     the internal key. The wallet defaults new accounts to taproot, so
   *     without this the common case stays broken.
   *  2. The BIP-322 connection proof, whose witness is [signature, pubkey].
   *     Covers older extension builds that predate the method. Accepted only
   *     if the key hashes to the address claiming it.
   *
   * Null when neither answers; core's own lookup still covers an address
   * that has spent before.
   */
  const multisigPubkey = useMemo(() => {
    if (!address) return null
    if (publicKey) return publicKey
    return connectionProof?.address === address
      ? pubkeyFromBip322(address, connectionProof.signature)
      : null
  }, [address, publicKey, connectionProof])
  const [state, setState] = useState<ComposeState>(INITIAL_STATE)
  const busyRef = useRef(false)

  // A stale error (e.g. "Wallet not authorized") shouldn't outlive the
  // condition that caused it. Connecting, switching, or disconnecting the
  // wallet clears it automatically instead of waiting for the user to
  // resubmit the exact same action.
  const lastAddressRef = useRef(address)
  useEffect(() => {
    if (lastAddressRef.current !== address) {
      lastAddressRef.current = address
      setState((s) => (s.status === 'error' ? INITIAL_STATE : s))
    }
  }, [address])

  /**
   * Compose → sign → broadcast pipeline. `getUnsigned` returns both the hex
   * to sign and the inputs it spends — recorded as spent only once broadcast
   * actually succeeds (composing alone spends nothing), so the NEXT compose
   * can tell core to exclude them regardless of which backend worker
   * answers it. See spent-utxos.ts for why that matters.
   */
  const run = async (
    getUnsigned: () => Promise<{ hex: string; inputs: TxInput[] }>,
  ): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true

    try {
      setState({ status: 'composing', txid: null, error: null })
      const { hex: unsignedHex, inputs } = await withUtxoRaceRetry(getUnsigned)

      setState({ status: 'signing', txid: null, error: null })
      const signedHex = await signTransaction(unsignedHex)

      setState({ status: 'broadcasting', txid: null, error: null })
      const txid = await broadcastTransaction(signedHex)

      registerSpentUtxos(inputs)
      setState({ status: 'confirmed', txid, error: null })
    } catch (e) {
      setState({ status: 'error', txid: null, error: composeError(e) })
    } finally {
      busyRef.current = false
    }
  }

  const execute = (
    type: string,
    params: Record<string, ComposeValue>,
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
    const excludeUtxos = recentlySpentUtxos()
    const composeWith = (allowUnconfirmed: boolean) =>
      composeRequest(
        `addresses/${address}`,
        type,
        params,
        {
          exclude_utxos_with_balances: 'true',
          // Without this, core's UTXO selection (list_unspent) only offers
          // already-CONFIRMED UTXOs. The moment one compose is pending, its
          // change output is unconfirmed and invisible to the next one — a
          // wallet with no other confirmed UTXOs reads as "not enough
          // BTC/XCP" for a second action, even though chaining off that
          // change is exactly what a real wallet does. This is what let
          // users stack a mint, then a swap, then a launch, back to back.
          allow_unconfirmed_inputs: allowUnconfirmed ? 'true' : 'false',
          // Belt-and-suspenders against the SAME UTXO being offered twice in
          // quick succession: core's own UTXOLocks guard is an in-memory,
          // per-process singleton that explicitly does not cross workers, so
          // two composes moments apart can land on different backend
          // processes that have never heard of each other's selection. This
          // excludes whatever WE know we just spent, regardless of which
          // worker answers.
          ...(excludeUtxos.length > 0 ? { exclude_utxos: excludeUtxos.join(',') } : {}),
          // Harmless when it isn't needed: core reads this only if the
          // message is too big for an OP_RETURN and it falls back to
          // multisig, so a mint or a swap ignores it and a launch depends
          // on it.
          ...(multisigPubkey ? { multisig_pubkey: multisigPubkey } : {}),
        },
        feeRateOverride,
      )

    run(async () => {
      let hex: string
      try {
        hex = await composeWith(true)
      } catch (e) {
        // The cost of allow_unconfirmed_inputs, and the fallback the wallet
        // extension already runs: core can offer a UTXO from its own mempool
        // view and then refuse the very selection it made, which surfaces as
        // a dead end on an address whose CONFIRMED coins would have composed
        // fine. Dropping to confirmed-only gives up chaining off pending
        // change — but only after the unconfirmed attempt has already
        // failed, so it costs nothing that was working.
        if (!STALE_UTXO_PATTERN.test(e instanceof Error ? e.message : String(e))) throw e
        hex = await composeWith(false)
      }
      return { hex, inputs: parseTxInputs(hex) }
    })
  }

  const executeUtxo = (utxo: string, type: string, params: Record<string, ComposeValue>): void => {
    if (!address) {
      setState({ status: 'error', txid: null, error: 'Wallet not connected' })
      return
    }
    if (!UTXO_REGEX.test(utxo)) {
      setState({ status: 'error', txid: null, error: 'Invalid UTXO format' })
      return
    }
    // Targets one exact, caller-specified UTXO — no ambiguous selection to
    // race, so nothing to record here.
    run(async () => {
      const hex = await composeRequest(`utxos/${utxo}`, type, params)
      return { hex, inputs: [] }
    })
  }

  const composeOrder = (params: {
    give_asset: string
    give_quantity: Quantity
    get_asset: string
    get_quantity: Quantity
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
    give_quantity: Quantity
    escrow_quantity: Quantity
    mainchainrate: Quantity
    status?: number
    /** sat/vB override; defaults to the next-block median at compose time. */
    fee_rate?: number
  }) => execute('dispenser', {
    asset: params.asset,
    give_quantity: params.give_quantity,
    escrow_quantity: params.escrow_quantity,
    mainchainrate: params.mainchainrate,
    status: params.status ?? 0,
  }, params.fee_rate)

  const composeDispense = (params: {
    dispenser: string
    quantity: Quantity
  }) => execute('dispense', {
    dispenser: params.dispenser,
    quantity: params.quantity,
  })

  const composeAttach = (params: {
    asset: string
    quantity: Quantity
  }) => execute('attach', {
    asset: params.asset,
    quantity: params.quantity,
  })

  const composePoolDeposit = (params: {
    asset_a: string
    asset_b: string
    quantity_a: Quantity
    quantity_b: Quantity
    min_lp_quantity?: Quantity
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
    quantity: Quantity
    min_quantity_a?: Quantity
    min_quantity_b?: Quantity
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
    price: Quantity
    quantity_by_price: Quantity
    hard_cap: Quantity
    soft_cap: Quantity
    start_block: number
    soft_cap_deadline_block: number
    max_mint_per_tx: Quantity
    max_mint_per_address: Quantity
    pool_quantity: Quantity
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
  const composeFairmint = (params: { asset: string; quantity: Quantity }) =>
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
