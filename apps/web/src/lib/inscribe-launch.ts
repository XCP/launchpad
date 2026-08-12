import { Address } from "@scure/btc-signer";
import {
  addressToScriptPubKey,
  buildCommitFundingPsbt,
  buildRevealPsbt,
  BURN_ADDRESS,
  finalizeSignedPsbt,
  txidFromRawTx,
} from "@/lib/inscriber";
import { prepareFairminterInscriptionPsbt } from "@/lib/inscriber/fairminter";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

const ELECTRS_API_BASE = "https://api.counterparty.io:3000";

export type InscribeStep =
  | "preparing"
  | "sign-commit"
  | "broadcast-commit"
  | "sign-reveal"
  | "broadcast-reveal"
  | "done";

interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

/** x-only pubkey from a taproot address (the bech32m witness program). */
export function taprootPubkey(address: string): Uint8Array {
  const decoded = Address().decode(address);
  if (!decoded || decoded.type !== "tr") {
    throw new Error("Inscribing requires a taproot (bc1p…) address");
  }
  return decoded.pubkey;
}

async function pickFundingUtxo(address: string, minValue: number): Promise<Utxo> {
  const res = await fetch(`${ELECTRS_API_BASE}/address/${address}/utxo`);
  if (!res.ok) throw new Error("Could not fetch UTXOs");
  const utxos: Utxo[] = await res.json();
  const candidates = utxos
    .filter((u) => u.status.confirmed && u.value >= minValue)
    .sort((a, b) => b.value - a.value);

  for (const utxo of candidates) {
    // Never spend a UTXO carrying Counterparty balances as plain fuel.
    const cp = await fetch(`${COUNTERPARTY_API_BASE}/utxos/${utxo.txid}:${utxo.vout}?verbose=true`);
    if (cp.ok) {
      const data = await cp.json();
      if (Array.isArray(data.result) ? data.result.length > 0 : data.result) continue;
    }
    return utxo;
  }
  throw new Error(`No spendable UTXO with at least ${minValue} sats (asset-bearing UTXOs are skipped)`);
}

/**
 * Commit/reveal an XCP-69 fairminter inscription: the image becomes the
 * permanent on-chain description, the inscription output is burned, and the
 * CIP-25 JSON URL rides in the ord metadata.
 */
export async function inscribeLaunch(opts: {
  asset: string;
  lpAsset: string;
  startBlock: number;
  softCapDeadlineBlock: number;
  jsonUrl: string;
  imageData: Uint8Array;
  mimeType: string;
  feeRate: number;
  address: string;
  signPsbt: (hex: string, signInputs?: Record<string, number[]>) => Promise<string>;
  broadcast: (hex: string) => Promise<string>;
  onStep: (step: InscribeStep) => void;
}): Promise<{ commitTxid: string; revealTxid: string }> {
  const { address, onStep } = opts;
  onStep("preparing");

  const pubkey = taprootPubkey(address);
  const prepared = prepareFairminterInscriptionPsbt(opts, pubkey);

  // Rough funding requirement: commit output + commit tx fee headroom.
  const fundingUtxo = await pickFundingUtxo(
    address,
    prepared.commitAmount + 2500 * Math.max(1, opts.feeRate),
  );
  const commit = buildCommitFundingPsbt({
    fundingUtxo: {
      txid: fundingUtxo.txid,
      vout: fundingUtxo.vout,
      value: fundingUtxo.value,
      scriptPubKey: addressToScriptPubKey(address),
    },
    commitAddress: prepared.commitAddress,
    commitAmount: prepared.commitAmount,
    changeAddress: address,
    feeRate: opts.feeRate,
  });

  onStep("sign-commit");
  const signedCommit = await opts.signPsbt(commit.psbtHex, { [address]: [0] });
  const commitRawTx = finalizeSignedPsbt(signedCommit);
  const commitTxid = txidFromRawTx(commitRawTx);

  onStep("broadcast-commit");
  await opts.broadcast(commitRawTx);

  // The inscription output is burned: the art belongs to the asset, not to a
  // holder, and a burned parent can never create child inscriptions.
  const reveal = buildRevealPsbt({
    pubkey,
    commitTxid,
    commitVout: 0,
    commitAmount: prepared.commitAmount,
    revealScript: prepared.revealScript,
    tapInternalKey: prepared.tapInternalKey,
    feeRate: opts.feeRate,
    recipientAddress: BURN_ADDRESS,
  });

  onStep("sign-reveal");
  const signedReveal = await opts.signPsbt(reveal.psbtHex, { [address]: [0] });
  const revealRawTx = finalizeSignedPsbt(signedReveal);

  onStep("broadcast-reveal");
  const revealTxid = await opts.broadcast(revealRawTx);

  onStep("done");
  return { commitTxid, revealTxid };
}
