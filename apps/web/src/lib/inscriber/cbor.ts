import type { InscriptionProperties } from '@/lib/inscriber/types'

/** Encode CBOR for the limited value set used by Ordinals metadata and XCP fields. */
export function encodeCbor(value: unknown): Uint8Array {
  const chunks: number[] = []

  function write(v: unknown) {
    if (v instanceof Uint8Array) {
      writeTypeLen(2, v.length)
      chunks.push(...v)
    } else if (typeof v === 'string') {
      const encoded = new TextEncoder().encode(v)
      writeTypeLen(3, encoded.length)
      chunks.push(...encoded)
    } else if (typeof v === 'bigint') {
      if (v >= BigInt(0)) writeBigUint(v)
      else writeBigNegative(v)
    } else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        if (v >= 0) writeTypeLen(0, v)
        else writeTypeLen(1, -v - 1)
      } else {
        chunks.push(0xfb)
        const buf = new ArrayBuffer(8)
        new DataView(buf).setFloat64(0, v)
        chunks.push(...new Uint8Array(buf))
      }
    } else if (typeof v === 'boolean') {
      chunks.push(v ? 0xf5 : 0xf4)
    } else if (v === null || v === undefined) {
      chunks.push(0xf6)
    } else if (Array.isArray(v)) {
      writeTypeLen(4, v.length)
      for (const item of v) write(item)
    } else if (v instanceof Map) {
      writeTypeLen(5, v.size)
      for (const [key, val] of v.entries()) {
        write(key)
        write(val)
      }
    } else if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      writeTypeLen(5, entries.length)
      for (const [key, val] of entries) {
        write(key)
        write(val)
      }
    }
  }

  function writeTypeLen(majorType: number, len: number) {
    const major = majorType << 5
    if (len < 24) chunks.push(major | len)
    else if (len < 256) chunks.push(major | 24, len)
    else if (len < 65536) chunks.push(major | 25, (len >> 8) & 0xff, len & 0xff)
    else chunks.push(major | 26, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
  }

  function writeBigUint(v: bigint) {
    if (v < BigInt(24)) chunks.push(Number(v))
    else if (v < BigInt(256)) chunks.push(0x18, Number(v))
    else if (v < BigInt(65536)) chunks.push(0x19, Number((v >> BigInt(8)) & BigInt(0xff)), Number(v & BigInt(0xff)))
    else if (v < BigInt(0x100000000)) {
      chunks.push(0x1a, Number((v >> BigInt(24)) & BigInt(0xff)), Number((v >> BigInt(16)) & BigInt(0xff)), Number((v >> BigInt(8)) & BigInt(0xff)), Number(v & BigInt(0xff)))
    } else {
      chunks.push(0x1b, Number((v >> BigInt(56)) & BigInt(0xff)), Number((v >> BigInt(48)) & BigInt(0xff)), Number((v >> BigInt(40)) & BigInt(0xff)), Number((v >> BigInt(32)) & BigInt(0xff)), Number((v >> BigInt(24)) & BigInt(0xff)), Number((v >> BigInt(16)) & BigInt(0xff)), Number((v >> BigInt(8)) & BigInt(0xff)), Number(v & BigInt(0xff)))
    }
  }

  function writeBigNegative(v: bigint) {
    const pos = -v - BigInt(1)
    if (pos < BigInt(24)) chunks.push(0x20 | Number(pos))
    else if (pos < BigInt(256)) chunks.push(0x38, Number(pos))
    else if (pos < BigInt(65536)) chunks.push(0x39, Number((pos >> BigInt(8)) & BigInt(0xff)), Number(pos & BigInt(0xff)))
    else if (pos < BigInt(0x100000000)) {
      chunks.push(0x3a, Number((pos >> BigInt(24)) & BigInt(0xff)), Number((pos >> BigInt(16)) & BigInt(0xff)), Number((pos >> BigInt(8)) & BigInt(0xff)), Number(pos & BigInt(0xff)))
    } else {
      chunks.push(0x3b, Number((pos >> BigInt(56)) & BigInt(0xff)), Number((pos >> BigInt(48)) & BigInt(0xff)), Number((pos >> BigInt(40)) & BigInt(0xff)), Number((pos >> BigInt(32)) & BigInt(0xff)), Number((pos >> BigInt(24)) & BigInt(0xff)), Number((pos >> BigInt(16)) & BigInt(0xff)), Number((pos >> BigInt(8)) & BigInt(0xff)), Number(pos & BigInt(0xff)))
    }
  }

  write(value)
  return new Uint8Array(chunks)
}

export function encodeProperties(props: InscriptionProperties): Uint8Array {
  const attributes = new Map<number, unknown>()
  if (props.title) attributes.set(0, props.title)
  if (props.traits && Object.keys(props.traits).length > 0) attributes.set(1, props.traits)
  return encodeCbor(new Map([[1, attributes]]))
}
