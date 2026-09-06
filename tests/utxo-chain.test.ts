import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addressScriptPubKey,
  ownTransactionOutputs,
  parseTxInputs,
  parseTxOutputs,
} from '@/lib/wallet/raw-tx'
import {
  pendingChangeInputs,
  recentlySpentUtxos,
  registerBroadcast,
} from '@/lib/wallet/spent-utxos'
import {
  addressTransactionLockName,
  withAddressTransactionLock,
} from '@/lib/wallet/transaction-lock'

const ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const OTHER_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
const PREVIOUS_TXID = '11'.repeat(32)
const BROADCAST_TXID = '22'.repeat(32)
const NEXT_TXID = '33'.repeat(32)
const ADDRESS_SCRIPT = '76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac'

// One ordinary P2PKH output to ADDRESS and one OP_RETURN output.
const RAW_TX = [
  '01000000',
  '01',
  '11'.repeat(32),
  '00000000',
  '00',
  'ffffffff',
  '02',
  'e803000000000000',
  '19',
  ADDRESS_SCRIPT,
  '0000000000000000',
  '01',
  '6a',
  '00000000',
].join('')

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('raw transaction metadata', () => {
  it('extracts input outpoints and complete wallet-owned output metadata', () => {
    expect(parseTxInputs(RAW_TX)).toEqual([{ txid: PREVIOUS_TXID, vout: 0 }])
    expect(addressScriptPubKey(ADDRESS)).toBe(ADDRESS_SCRIPT)
    expect(parseTxOutputs(RAW_TX)).toEqual([
      { vout: 0, value: 1_000, scriptPubKey: ADDRESS_SCRIPT },
      { vout: 1, value: 0, scriptPubKey: '6a' },
    ])
    expect(ownTransactionOutputs(RAW_TX, ADDRESS)).toEqual([
      { vout: 0, value: 1_000, scriptPubKey: ADDRESS_SCRIPT },
    ])
    expect(ownTransactionOutputs(RAW_TX, OTHER_ADDRESS)).toEqual([])
  })
})

describe('cross-tab UTXO journal', () => {
  it('turns safe change into a complete inputs_set entry', () => {
    registerBroadcast(
      ADDRESS,
      BROADCAST_TXID,
      [{ txid: PREVIOUS_TXID, vout: 0 }],
      ownTransactionOutputs(RAW_TX, ADDRESS),
    )

    expect(recentlySpentUtxos(ADDRESS)).toEqual([`${PREVIOUS_TXID}:0`])
    expect(pendingChangeInputs(ADDRESS)).toEqual([
      `${BROADCAST_TXID}:0:1000:${ADDRESS_SCRIPT}`,
    ])
  })

  it('sees a later write immediately and removes change once it is spent', () => {
    registerBroadcast(
      ADDRESS,
      BROADCAST_TXID,
      [{ txid: PREVIOUS_TXID, vout: 0 }],
      [{ vout: 1, value: 2_000, scriptPubKey: ADDRESS_SCRIPT }],
    )
    registerBroadcast(
      ADDRESS,
      NEXT_TXID,
      [{ txid: BROADCAST_TXID, vout: 1 }],
      [{ vout: 2, value: 1_500, scriptPubKey: ADDRESS_SCRIPT }],
    )

    expect(recentlySpentUtxos(ADDRESS)).toEqual([
      `${BROADCAST_TXID}:1`,
      `${PREVIOUS_TXID}:0`,
    ])
    expect(pendingChangeInputs(ADDRESS)).toEqual([
      `${NEXT_TXID}:2:1500:${ADDRESS_SCRIPT}`,
    ])
  })

  it('keeps addresses isolated and records no chainable output when none is supplied', () => {
    registerBroadcast(ADDRESS, BROADCAST_TXID, [{ txid: PREVIOUS_TXID, vout: 0 }], [])

    expect(pendingChangeInputs(ADDRESS)).toEqual([])
    expect(recentlySpentUtxos(OTHER_ADDRESS)).toEqual([])
  })
})

describe('address transaction lock', () => {
  it('uses one case-normalized lock name for a bech32 address', () => {
    expect(addressTransactionLockName('BC1QEXAMPLE')).toBe(
      addressTransactionLockName('bc1qexample'),
    )
  })

  it('serializes callbacks when Web Locks are unavailable', async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withAddressTransactionLock(ADDRESS, async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
    })
    const second = withAddressTransactionLock(ADDRESS, async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })
})
