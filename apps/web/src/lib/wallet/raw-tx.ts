/**
 * Just enough raw-transaction parsing to answer one question: which UTXOs
 * does this transaction spend? Counterparty's verbose compose response
 * carries `lock_scripts`/`inputs_values` (parallel arrays) but never the
 * actual txid:vout of each input, so the only place to recover it is the
 * transaction bytes themselves — and the input section is early enough
 * (right after the optional segwit marker/flag) that nothing past it, not
 * outputs, witness data, or locktime, needs parsing at all.
 */
export interface TxInput {
  txid: string;
  vout: number;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function parseTxInputs(hex: string): TxInput[] {
  const bytes = hexToBytes(hex);
  let offset = 4; // version

  // BIP144 marker+flag: 0x00 immediately after version, followed by a
  // non-zero flag. An input count can never legally be encoded as 0x00
  // followed by a var-int continuation, so this pair is unambiguous.
  if (bytes[offset] === 0x00 && bytes[offset + 1] !== 0x00) {
    offset += 2;
  }

  const readVarInt = (): number => {
    const first = bytes[offset];
    offset += 1;
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const v = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2;
      return v;
    }
    if (first === 0xfe) {
      const v =
        (bytes[offset] |
          (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) |
          (bytes[offset + 3] << 24)) >>>
        0;
      offset += 4;
      return v;
    }
    // 0xff: 8-byte count. No real transaction has anywhere near this many
    // inputs; treat as malformed rather than risk a bigint/Number mismatch.
    throw new Error("unsupported var-int width");
  };

  const inputCount = readVarInt();
  const inputs: TxInput[] = [];
  for (let i = 0; i < inputCount; i++) {
    const prevHash = bytes.slice(offset, offset + 32);
    offset += 32;
    const vout =
      (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    offset += 4;
    const scriptLen = readVarInt();
    offset += scriptLen; // scriptSig — empty pre-signing, but skip generically
    offset += 4; // sequence
    // Displayed txid is the byte-reversed internal hash.
    const txid = Array.from(prevHash)
      .reverse()
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    inputs.push({ txid, vout });
  }
  return inputs;
}
