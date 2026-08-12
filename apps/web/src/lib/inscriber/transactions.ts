import * as btc from '@scure/btc-signer'
import { hex } from '@scure/base'
import { buildInscriptionScript } from '@/lib/inscriber/ordinals'
import {
  COMMIT_TX_VSIZE,
  COUNTERPARTY_MARKER_OP_RETURN,
  MAX_RECOMMENDED_REVEAL_WEIGHT,
  NETWORK,
  P2PKH_DUST_SATS,
  RBF_SEQUENCE,
  REVEAL_FEE_PADDING_BPS,
} from '@/lib/inscriber/constants'
import type {
  CommitFundingPsbtResult,
  FundingUtxo,
  InscriptionData,
  ParentUtxo,
  PreparedInscriptionCommit,
  RevealPsbtResult,
  RevealWeightEstimate,
} from '@/lib/inscriber/types'

export { hex as hexCodec }

function compactSizeLength(value: number): number {
  if (value < 253) return 1
  if (value <= 0xffff) return 3
  if (value <= 0xffffffff) return 5
  return 9
}

function txOutputSize(scriptSize: number): number {
  return 8 + compactSizeLength(scriptSize) + scriptSize
}

export function estimateRevealWeight(scriptSize: number, hasParentInput = false): RevealWeightEstimate {
  const inputCount = hasParentInput ? 2 : 1
  const outputCount = hasParentInput ? 3 : 2
  const markerScriptSize = COUNTERPARTY_MARKER_OP_RETURN.length
  const p2pkhScriptSize = 25
  const strippedSize = (
    4
    + compactSizeLength(inputCount)
    + inputCount * 41
    + compactSizeLength(outputCount)
    + txOutputSize(markerScriptSize)
    + txOutputSize(p2pkhScriptSize)
    + (hasParentInput ? txOutputSize(p2pkhScriptSize) : 0)
    + 4
  )
  const taprootWitnessSize = (
    1
    + compactSizeLength(65) + 65
    + compactSizeLength(scriptSize) + scriptSize
    + compactSizeLength(33) + 33
  )
  const parentWitnessSize = hasParentInput ? 108 : 0
  const weight = strippedSize * 4 + 2 + taprootWitnessSize + parentWitnessSize

  return {
    scriptSize,
    weight,
    vsize: Math.ceil(weight / 4),
    maxRecommendedWeight: MAX_RECOMMENDED_REVEAL_WEIGHT,
    remainingWeight: MAX_RECOMMENDED_REVEAL_WEIGHT - weight,
  }
}

function feePadding(fee: number): number {
  return Math.ceil((fee * REVEAL_FEE_PADDING_BPS) / 10_000)
}

export function prepareCommit(
  pubkey: Uint8Array,
  data: InscriptionData,
  feeRate: number,
): PreparedInscriptionCommit {
  if (pubkey.length !== 32) throw new Error('Taproot public key must be 32 bytes')
  assertPositiveFeeRate(feeRate)

  const script = buildInscriptionScript(pubkey, data)
  const tapInternalKey = btc.TAPROOT_UNSPENDABLE_KEY
  const commitOutput = btc.p2tr(tapInternalKey, { script, leafVersion: 0xc0 }, NETWORK, true)
  const revealWeight = estimateRevealWeight(script.length, !!data.parentInscriptionId)
  const revealBaseFee = revealWeight.vsize * feeRate
  const revealFeePadding = feePadding(revealBaseFee)
  const revealFundedFee = revealBaseFee + revealFeePadding

  return {
    commitAddress: commitOutput.address!,
    commitAmount: revealFundedFee + P2PKH_DUST_SATS,
    revealScript: script,
    tapInternalKey,
    revealWeight,
    revealBaseFee,
    revealFeePadding,
    revealFundedFee,
  }
}

export function addressToScriptPubKey(address: string): Uint8Array {
  const decoded = btc.Address(NETWORK).decode(address)
  if (!decoded) throw new Error(`Cannot decode address: ${address}`)
  return btc.OutScript.encode(decoded)
}

export function pubkeyToP2wpkhAddress(pubkey: Uint8Array): string {
  return btc.p2wpkh(pubkey, NETWORK).address!
}

export function buildCommitFundingPsbt(params: {
  fundingUtxo: FundingUtxo
  commitAddress: string
  commitAmount: number
  changeAddress: string
  feeRate: number
}): CommitFundingPsbtResult {
  const { fundingUtxo, commitAddress, commitAmount, changeAddress, feeRate } = params
  assertPositiveFeeRate(feeRate)
  assertPositiveSats('commitAmount', commitAmount)
  assertFundingUtxo(fundingUtxo)

  const estimatedFee = Math.ceil(feeRate * COMMIT_TX_VSIZE)
  const changeAmount = fundingUtxo.value - commitAmount - estimatedFee

  if (changeAmount < 0) {
    throw new Error(`Funding UTXO is too small. Need at least ${commitAmount + estimatedFee} sats.`)
  }

  const tx = new btc.Transaction()
  tx.addInput({
    txid: fundingUtxo.txid,
    index: fundingUtxo.vout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: {
      script: fundingUtxo.scriptPubKey,
      amount: BigInt(fundingUtxo.value),
    },
    sighashType: btc.SigHash.ALL,
  })
  tx.addOutputAddress(commitAddress, BigInt(commitAmount), NETWORK)
  if (changeAmount >= P2PKH_DUST_SATS) tx.addOutputAddress(changeAddress, BigInt(changeAmount), NETWORK)

  return {
    psbtHex: hex.encode(tx.toPSBT()),
    inputValue: fundingUtxo.value,
    commitAmount,
    estimatedFee,
    changeAmount: changeAmount >= P2PKH_DUST_SATS ? changeAmount : 0,
  }
}

export function buildRevealPsbt(params: {
  pubkey: Uint8Array
  commitTxid: string
  commitVout: number
  commitAmount: number
  revealScript: Uint8Array
  tapInternalKey: Uint8Array
  feeRate: number
  recipientAddress: string
  parentUtxo?: ParentUtxo
  parentReturnAddress?: string
}): RevealPsbtResult {
  const {
    pubkey,
    commitTxid,
    commitVout,
    commitAmount,
    revealScript,
    tapInternalKey,
    feeRate,
    recipientAddress,
    parentUtxo,
    parentReturnAddress,
  } = params
  if (pubkey.length !== 32) throw new Error('Taproot public key must be 32 bytes')
  assertPositiveFeeRate(feeRate)
  assertPositiveSats('commitAmount', commitAmount)
  if (parentUtxo) assertFundingUtxo(parentUtxo)

  const tx = new btc.Transaction({ allowUnknownOutputs: true })
  const commitP2tr = btc.p2tr(tapInternalKey, { script: revealScript, leafVersion: 0xc0 }, NETWORK, true)

  if (parentUtxo) {
    tx.addInput({
      txid: parentUtxo.txid,
      index: parentUtxo.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: parentUtxo.scriptPubKey,
        amount: BigInt(parentUtxo.value),
      },
      sighashType: btc.SigHash.ALL,
    })
  }

  tx.addInput({
    txid: commitTxid,
    index: commitVout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: {
      script: commitP2tr.script,
      amount: BigInt(commitAmount),
    },
    tapLeafScript: commitP2tr.tapLeafScript,
    sighashType: btc.SigHash.ALL,
  })

  tx.addOutput({ script: COUNTERPARTY_MARKER_OP_RETURN, amount: BigInt(0) })
  tx.addOutputAddress(recipientAddress, BigInt(P2PKH_DUST_SATS), NETWORK)

  if (parentUtxo) {
    tx.addOutputAddress(parentReturnAddress || recipientAddress, BigInt(P2PKH_DUST_SATS), NETWORK)
  }

  return {
    psbtHex: hex.encode(tx.toPSBT()),
    estimatedFee: commitAmount - P2PKH_DUST_SATS + (parentUtxo ? parentUtxo.value - P2PKH_DUST_SATS : 0),
    markerOutputIndex: 0,
    inscriptionOutputIndex: 1,
    ...(parentUtxo && { parentReturnOutputIndex: 2 as const }),
  }
}

function assertPositiveFeeRate(feeRate: number) {
  if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('feeRate must be a positive number')
}

function assertPositiveSats(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer number of sats`)
}

function assertFundingUtxo(utxo: FundingUtxo | ParentUtxo) {
  if (!/^[0-9a-fA-F]{64}$/.test(utxo.txid)) throw new Error(`Invalid UTXO txid: ${utxo.txid}`)
  if (!Number.isSafeInteger(utxo.vout) || utxo.vout < 0) throw new Error(`Invalid UTXO vout: ${utxo.vout}`)
  assertPositiveSats('UTXO value', utxo.value)
  if (utxo.scriptPubKey.length === 0) throw new Error('UTXO scriptPubKey is required')
}

export function signPsbtInput(psbtHex: string, privateKey: Uint8Array, inputIndex: number): string {
  const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex))
  tx.signIdx(privateKey, inputIndex)
  return hex.encode(tx.toPSBT())
}

export function finalizeSignedPsbt(signedPsbtHex: string): string {
  const tx = btc.Transaction.fromPSBT(hex.decode(signedPsbtHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  })
  tx.finalize()
  return hex.encode(tx.extract())
}

export function txidFromRawTx(rawTxHex: string): string {
  return btc.Transaction.fromRaw(hex.decode(rawTxHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  }).id
}
