import { Address } from "@scure/btc-signer";
import {
  addressToScriptPubKey,
  buildCommitFundingPsbt,
  buildRevealPsbt,
  BURN_ADDRESS,
  finalizeSignedPsbt,
  hexCodec,
  txidFromRawTx,
} from "@/lib/inscriber";
import { prepareFairminterInscriptionPsbt } from "@/lib/inscriber/fairminter";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { WalletSdkError } from "@xcp/wallet-sdk";
import { parseRawInteger } from "@xcp/wallet-sdk/amounts";
import { assertSameTransaction, readPsbt, readTransaction } from "@/lib/transaction-verification";

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

/** Core queries.get_utxo_balances filters positive balances. Only a complete
 * successful empty page is proof of no confirmed Counterparty balances. */
async function hasCounterpartyBalances(utxo: Utxo): Promise<boolean> {
  const cp = await fetch(`${COUNTERPARTY_API_BASE}/utxos/${utxo.txid}:${utxo.vout}/balances?limit=1`);
  if (!cp.ok) throw new WalletSdkError("network", `Could not verify funding UTXO balances: HTTP ${cp.status}`);
  const data = await cp.json();
  if (data.error || !Array.isArray(data.result) || (data.result.length === 0 && data.next_cursor !== null)) {
    throw new WalletSdkError("invalid_response", "Could not verify funding UTXO balances");
  }
  return data.result.length > 0;
}

/** The witness prevout must agree with the exact, hash-verified parent bytes. */
async function verifyFundingPrevout(utxo: Utxo, address: string): Promise<void> {
  const response = await fetch(`${ELECTRS_API_BASE}/tx/${utxo.txid}/hex`);
  if (!response.ok) throw new WalletSdkError("network", `Could not verify funding transaction: HTTP ${response.status}`);
  const parent = readTransaction(await response.text());
  const output = utxo.vout < parent.outputsLength ? parent.getOutput(utxo.vout) : undefined;
  if (parent.id !== utxo.txid || output?.amount !== BigInt(utxo.value)
    || !output.script || hexCodec.encode(output.script) !== hexCodec.encode(addressToScriptPubKey(address))) {
    throw new WalletSdkError("transaction_mismatch", "Funding UTXO does not match its parent transaction");
  }
}

async function pickFundingUtxo(address: string, minValue: number): Promise<Utxo> {
  const res = await fetch(`${ELECTRS_API_BASE}/address/${address}/utxo`);
  if (!res.ok) throw new Error("Could not fetch UTXOs");
  const utxos: Utxo[] = await res.json();
  if (!Array.isArray(utxos)) throw new WalletSdkError("invalid_response", "Invalid funding UTXO list");
  for (const utxo of utxos) {
    if (!/^[0-9a-f]{64}$/.test(utxo.txid) || !Number.isSafeInteger(utxo.vout) || utxo.vout < 0
      || typeof utxo.status?.confirmed !== "boolean") throw new WalletSdkError("invalid_response", "Invalid funding UTXO");
    parseRawInteger(utxo.value, { min: 1n, max: 2_100_000_000_000_000n });
  }
  const candidates = utxos
    .filter((u) => u.status.confirmed && u.value >= minValue)
    .sort((a, b) => b.value - a.value);

  for (const utxo of candidates) {
    // Never spend a UTXO carrying Counterparty balances as plain fuel.
    if (await hasCounterpartyBalances(utxo)) continue;
    await verifyFundingPrevout(utxo, address);
    return utxo;
  }
  throw new Error(`No spendable UTXO with at least ${minValue} sats (asset-bearing UTXOs are skipped)`);
}

/**
 * Commit/reveal an XCP-69 fairminter inscription: the image is inscribed, the
 * inscription output is burned, and the fairminter message rides in the ord
 * metadata with the hosted JSON URL as its Counterparty description, the same
 * description an ordinary launch records. The JSON in turn names the
 * inscription (see the POST handler in app/api/launches), so each side can
 * find the other.
 */
export async function inscribeLaunch(opts: {
  asset: string;
  lpAsset: string;
  startBlock: number;
  softCapDeadlineBlock: number;
  imageData: Uint8Array;
  mimeType: string;
  feeRate: number;
  /** The hosted JSON URL, recorded as the fairminter's description. */
  description: string;
  address: string;
  signPsbt: (
    hex: string,
    signInputs?: Record<string, number[]>,
    sighashTypes?: number[],
    inscription?: { revealScript: string; tapInternalKey: string },
  ) => Promise<string>;
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
  // The commit is unprovable BTC movement without its envelope: the wallet re-derives the commit
  // address and message from these and refuses on any mismatch, so honest commits sign and
  // anything else cannot.
  const signedCommit = await opts.signPsbt(commit.psbtHex, { [address]: [0] }, undefined, {
    revealScript: hexCodec.encode(prepared.revealScript),
    tapInternalKey: hexCodec.encode(prepared.tapInternalKey),
  });
  assertSameTransaction(readPsbt(commit.psbtHex), readPsbt(signedCommit));
  const commitRawTx = finalizeSignedPsbt(signedCommit);
  assertSameTransaction(readPsbt(commit.psbtHex), readTransaction(commitRawTx));
  const commitTxid = txidFromRawTx(commitRawTx);

  // Recheck after a potentially long wallet approval, before spending fuel.
  if (await hasCounterpartyBalances(fundingUtxo)) {
    throw new WalletSdkError("invalid_argument", "Funding UTXO now carries Counterparty balances");
  }
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
  assertSameTransaction(readPsbt(reveal.psbtHex), readPsbt(signedReveal));
  const revealRawTx = finalizeSignedPsbt(signedReveal);
  assertSameTransaction(readPsbt(reveal.psbtHex), readTransaction(revealRawTx));

  onStep("broadcast-reveal");
  const revealTxid = await opts.broadcast(revealRawTx);

  onStep("done");
  return { commitTxid, revealTxid };
}
