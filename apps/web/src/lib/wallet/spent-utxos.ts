'use client'

/**
 * A short-lived, address-scoped journal of our own broadcasts.
 *
 * The gap this closes: core's own UTXOLocks (composer.py) is an in-memory,
 * per-process singleton — its own doc comment says as much: "does NOT cross
 * processes -- multi-worker deployments still need a shared store." A public
 * API server fielding real traffic is exactly that kind of deployment, so
 * two composes moments apart can land on two different workers, each with
 * its own lock table that's never heard of the other's selection — the
 * second one can pick a UTXO the first already spent, producing an
 * unsignable/rejected transaction. We don't control that infrastructure, so
 * the fix has to live here: remember what WE just spent, and tell every
 * later compose to exclude it via `exclude_utxos`, regardless of which
 * backend worker answers.
 *
 * Alongside spent inputs, it records ordinary outputs returning to the
 * source address. Their value and scriptPubKey make a complete Counterparty
 * `inputs_set` entry, so Core can compose from change it has not indexed yet
 * without asking Bitcoin Core/Electrs to resolve the parent transaction.
 *
 * There is deliberately no module cache. Every read happens after the
 * address's Web Lock is acquired, so another tab's just-finished broadcast
 * is visible immediately and writes cannot merge against stale memory.
 */

const KEY_PREFIX = 'xcpfun:utxo-chain:v2:'
const MAX_AGE_MS = 15 * 60 * 1000
const MAX_ENTRIES = 50
const TXID_PATTERN = /^[a-f0-9]{64}$/i
const SCRIPT_PATTERN = /^(?:[a-f0-9]{2})+$/i

interface SpentUtxo {
  utxo: string // "txid:vout"
  addedAt: number
}

interface ChainableUtxo {
  utxo: string
  value: number
  scriptPubKey: string
  addedAt: number
}

interface Journal {
  spent: SpentUtxo[]
  chainable: ChainableUtxo[]
}

export interface OwnTxOutput {
  vout: number
  value: number
  scriptPubKey: string
}

function normalizedAddress(address: string): string {
  return /^(?:bc1|tb1|bcrt1)/i.test(address) ? address.toLowerCase() : address
}

function storageKey(address: string): string {
  return `${KEY_PREFIX}${normalizedAddress(address)}`
}

function isSpentUtxo(value: unknown): value is SpentUtxo {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SpentUtxo>
  return (
    typeof item.utxo === 'string' &&
    /^[a-f0-9]{64}:\d+$/i.test(item.utxo) &&
    typeof item.addedAt === 'number' &&
    Number.isFinite(item.addedAt)
  )
}

function isChainableUtxo(value: unknown): value is ChainableUtxo {
  if (!isSpentUtxo(value)) return false
  const item = value as Partial<ChainableUtxo>
  return (
    typeof item.value === 'number' &&
    Number.isSafeInteger(item.value) &&
    item.value >= 0 &&
    typeof item.scriptPubKey === 'string' &&
    item.scriptPubKey.length <= 20_000 &&
    SCRIPT_PATTERN.test(item.scriptPubKey)
  )
}

function fresh<T extends { addedAt: number }>(items: T[]): T[] {
  const now = Date.now()
  return items.filter((item) => now - item.addedAt >= 0 && now - item.addedAt < MAX_AGE_MS)
}

function load(address: string): Journal {
  if (typeof localStorage === 'undefined') return { spent: [], chainable: [] }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(address)) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return { spent: [], chainable: [] }
    const journal = parsed as Partial<Journal>
    const spent = Array.isArray(journal.spent) ? fresh(journal.spent.filter(isSpentUtxo)) : []
    const spentSet = new Set(spent.map((item) => item.utxo))
    const chainable = Array.isArray(journal.chainable)
      ? fresh(journal.chainable.filter(isChainableUtxo)).filter(
          (item) => !spentSet.has(item.utxo),
        )
      : []
    return { spent, chainable }
  } catch {
    return { spent: [], chainable: [] }
  }
}

function write(address: string, journal: Journal) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(storageKey(address), JSON.stringify(journal))
  } catch {
    // Private mode or quota: the exclusion just won't survive a reload.
  }
}

/** Recently-spent UTXOs still worth excluding, "txid:vout" each. */
export function recentlySpentUtxos(address: string): string[] {
  return load(address).spent.map((item) => item.utxo)
}

/** Complete entries that Core can consume without resolving their parents. */
export function pendingChangeInputs(address: string): string[] {
  return load(address).chainable.map(
    (item) => `${item.utxo}:${item.value}:${item.scriptPubKey}`,
  )
}

/**
 * How long ago our own most recent broadcast happened, or null if none is
 * tracked. `exclude_utxos` only solves "don't offer the OLD input again" —
 * it can't manufacture a NEW change output that hasn't propagated to
 * whichever of the backend's replicas answers next. A wallet down to
 * exactly one UTXO hits that gap for real: right after broadcast, the old
 * UTXO is excluded and the new change may not be visible anywhere yet, so
 * "insufficient funds" is briefly, correctly true. This is what lets a
 * caller tell that apart from an actually-empty wallet — see useCompose's
 * retry, which is the other half of this.
 */
export function msSinceLastSpend(address: string): number | null {
  const spent = load(address).spent
  if (spent.length === 0) return null
  return Date.now() - Math.max(...spent.map((item) => item.addedAt))
}

/**
 * Commit one successful broadcast to the journal while its address lock is
 * still held. `ownOutputs` must contain only ordinary, wallet-owned change;
 * callers pass an empty list for attach/detach/UTXO-binding transactions.
 */
export function registerBroadcast(
  address: string,
  txid: string,
  inputs: { txid: string; vout: number }[],
  ownOutputs: OwnTxOutput[],
) {
  if (typeof localStorage === 'undefined') return
  if (!TXID_PATTERN.test(txid)) return

  const now = Date.now()
  const journal = load(address)
  const additions = inputs
    .filter((input) => TXID_PATTERN.test(input.txid) && Number.isSafeInteger(input.vout) && input.vout >= 0)
    .map((input) => ({ utxo: `${input.txid}:${input.vout}`, addedAt: now }))
  const spentByThisTx = new Set(additions.map((item) => item.utxo))
  const spent = [...additions, ...journal.spent]
    .filter((item, index, all) => all.findIndex((other) => other.utxo === item.utxo) === index)
    .slice(0, MAX_ENTRIES)

  const newChange: ChainableUtxo[] = ownOutputs
    .filter(
      (output) =>
        Number.isSafeInteger(output.vout) &&
        output.vout >= 0 &&
        Number.isSafeInteger(output.value) &&
        output.value >= 0 &&
        output.scriptPubKey.length <= 20_000 &&
        SCRIPT_PATTERN.test(output.scriptPubKey),
    )
    .map((output) => ({
      utxo: `${txid}:${output.vout}`,
      value: output.value,
      scriptPubKey: output.scriptPubKey,
      addedAt: now,
    }))
  const chainable = [...newChange, ...journal.chainable]
    .filter((item) => !spentByThisTx.has(item.utxo))
    .filter((item, index, all) => all.findIndex((other) => other.utxo === item.utxo) === index)
    .slice(0, MAX_ENTRIES)

  write(address, { spent, chainable })
}
