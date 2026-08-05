import { hex } from '@scure/base'
import { encodeCbor, encodeProperties } from './cbor'
import type { InscriptionData } from './types'

function parseInscriptionId(id: string): { txid: Uint8Array; index: number } {
  if (!/^([0-9a-fA-F]{64}i\d+|[0-9a-fA-F]{64}:\d+)$/.test(id)) {
    throw new Error(`Invalid inscription id: ${id}`)
  }
  const [txidHex, indexText = '0'] = id.includes('i') ? id.split('i') : id.split(':')
  const index = Number(indexText)
  if (!Number.isSafeInteger(index) || index < 0) throw new Error(`Invalid inscription index: ${indexText}`)

  const txidBytes = hex.decode(txidHex)
  const reversed = new Uint8Array(txidBytes.length)
  for (let i = 0; i < txidBytes.length; i++) reversed[i] = txidBytes[txidBytes.length - 1 - i]
  return { txid: reversed, index }
}

function encodeIndex(index: number): Uint8Array {
  if (index === 0) return new Uint8Array([])
  const buf = new ArrayBuffer(4)
  new DataView(buf).setUint32(0, index, true)
  const arr = new Uint8Array(buf)
  let len = 4
  while (len > 1 && arr[len - 1] === 0) len--
  return arr.slice(0, len)
}

function pushData(ops: (number | Uint8Array)[], data: Uint8Array) {
  if (data.length < 76) ops.push(data.length)
  else if (data.length < 256) ops.push(0x4c, data.length)
  else ops.push(0x4d, data.length & 0xff, (data.length >> 8) & 0xff)
  ops.push(data)
}

function pushTaggedChunked(ops: (number | Uint8Array)[], tag: number, data: Uint8Array) {
  for (let i = 0; i < data.length; i += 520) {
    pushData(ops, new Uint8Array([tag]))
    pushData(ops, data.slice(i, i + 520))
  }
}

export function buildInscriptionScript(pubkey: Uint8Array, data: InscriptionData): Uint8Array {
  const ops: (number | Uint8Array)[] = []
  ops.push(0x00) // OP_FALSE
  ops.push(0x63) // OP_IF
  pushData(ops, hex.decode('6f7264')) // "ord"

  if (data.metaprotocol) {
    pushData(ops, new Uint8Array([0x07]))
    pushData(ops, new TextEncoder().encode(data.metaprotocol))
  }

  pushData(ops, new Uint8Array([0x01]))
  pushData(ops, new TextEncoder().encode(data.contentType))

  if (data.parentInscriptionId) {
    const parent = parseInscriptionId(data.parentInscriptionId)
    const idxBytes = encodeIndex(parent.index)
    const parentValue = new Uint8Array(parent.txid.length + idxBytes.length)
    parentValue.set(parent.txid)
    parentValue.set(idxBytes, parent.txid.length)
    pushData(ops, new Uint8Array([0x03]))
    pushData(ops, parentValue)
  }

  if (data.properties) pushTaggedChunked(ops, 0x11, encodeProperties(data.properties))
  if (data.metadata) pushTaggedChunked(ops, 0x05, encodeCbor(data.metadata))

  ops.push(0x00) // OP_0 body separator
  for (let i = 0; i < data.body.length; i += 520) pushData(ops, data.body.slice(i, i + 520))
  ops.push(0x68) // OP_ENDIF

  // Counterparty's taproot parser expects the signature check after the envelope.
  pushData(ops, pubkey)
  ops.push(0xac) // OP_CHECKSIG

  let totalLen = 0
  for (const op of ops) totalLen += op instanceof Uint8Array ? op.length : 1
  const script = new Uint8Array(totalLen)
  let offset = 0
  for (const op of ops) {
    if (op instanceof Uint8Array) {
      script.set(op, offset)
      offset += op.length
    } else {
      script[offset++] = op
    }
  }
  return script
}
