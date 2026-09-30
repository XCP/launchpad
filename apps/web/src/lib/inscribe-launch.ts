import { Address, SigHash, type Transaction } from "@scure/btc-signer";
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
import { BITCOIN_API_BASE, COUNTERPARTY_API_BASE } from "@/lib/constants";
import {
  type CommitAndRevealParams,
  type CommitAndRevealResult,
  finalizeCommitAndReveal,
  isWalletSdkError,
  WalletSdkError,
} from "@xcp/wallet-sdk";
import { parseRawInteger } from "@xcp/wallet-sdk/amounts";
import { clearPendingReveal, type PendingReveal, savePendingReveal } from "@/lib/pending-reveal";
import { assertSameTransaction, readPsbt, readTransaction } from "@/lib/transaction-verification";

const ELECTRS_API_BASE = BITCOIN_API_BASE;

export type InscribeStep =
  | "preparing"
  | "sign-bundle"
  | "sign-commit"
  | "broadcast-commit"
  | "sign-reveal"
  | "broadcast-reveal"
  | "done";

type SignPsbt = (
  hex: string,
  signInputs?: Record<string, number[]>,
  sighashTypes?: number[],
  inscription?: { revealScript: string; tapInternalKey: string },
) => Promise<string>;

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
 *
 * With `signCommitAndReveal` (a wallet listing the `commit-and-reveal`
 * bundle, XCP Wallet 0.14.1+), both are signed in one approval before either
 * is broadcast. Otherwise the commit is signed and broadcast first and the
 * reveal asked for after. Either way the envelope is kept (lib/pending-reveal)
 * from just before the commit goes out until the reveal does, and
 * `resumeInscribeLaunch` finishes a launch that stopped in between.
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
  signPsbt: SignPsbt;
  /** Only for a wallet that lists `commit-and-reveal` in its PSBT bundle kinds. */
  signCommitAndReveal?: (params: CommitAndRevealParams) => Promise<CommitAndRevealResult>;
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
  // The inscription output is burned: the art belongs to the asset, not to a
  // holder, and a burned parent can never create child inscriptions.
  const revealFor = (commitTxid: string) => buildRevealPsbt({
    pubkey,
    commitTxid,
    commitVout: 0,
    commitAmount: prepared.commitAmount,
    revealScript: prepared.revealScript,
    tapInternalKey: prepared.tapInternalKey,
    feeRate: opts.feeRate,
    recipientAddress: BURN_ADDRESS,
  });
  const pending = (commitTxid: string, commitRawTx: string, revealRawTx?: string): PendingReveal => ({
    version: 1,
    address,
    asset: opts.asset,
    startBlock: opts.startBlock,
    revealScript: hexCodec.encode(prepared.revealScript),
    tapInternalKey: hexCodec.encode(prepared.tapInternalKey),
    commitTxid,
    commitVout: 0,
    commitAmount: prepared.commitAmount,
    commitRawTx,
    recipient: BURN_ADDRESS,
    feeRate: opts.feeRate,
    ...(revealRawTx ? { revealRawTx } : {}),
    createdAt: Date.now(),
  });
  // Recheck after a potentially long wallet approval, before spending fuel.
  const assertFuelStillPlain = async () => {
    if (await hasCounterpartyBalances(fundingUtxo)) {
      throw new WalletSdkError("invalid_argument", "Funding UTXO now carries Counterparty balances");
    }
  };

  if (opts.signCommitAndReveal) {
    // Every commit input is segwit, so its txid is fixed before it is signed:
    // the reveal can be built, and signed, against the unsigned commit.
    const commitTxid = readPsbt(commit.psbtHex).id;
    const reveal = revealFor(commitTxid);
    onStep("sign-bundle");
    let signed: CommitAndRevealResult | null = null;
    try {
      signed = await opts.signCommitAndReveal({
        source: address,
        commitPsbt: commit.psbtHex,
        revealPsbt: reveal.psbtHex,
        commitSighashType: SigHash.ALL,
        revealSighashType: SigHash.ALL,
      });
    } catch (error) {
      // Refused before any prompt (the wallet cannot sign this bundle after
      // all): nothing is signed or broadcast, so the two-step flow is safe.
      if (!isWalletSdkError(error, "capability")) throw error;
    }
    if (signed) {
      assertSameTransaction(readPsbt(commit.psbtHex), readPsbt(signed.commit));
      assertSameTransaction(readPsbt(reveal.psbtHex), readPsbt(signed.reveal));
      const raw = finalizeCommitAndReveal(signed);
      assertSameTransaction(readPsbt(commit.psbtHex), readTransaction(raw.commit));
      assertSameTransaction(readPsbt(reveal.psbtHex), readTransaction(raw.reveal));
      if (txidFromRawTx(raw.commit) !== commitTxid) {
        throw new WalletSdkError("transaction_mismatch", "Signed commit is not the commit the reveal spends");
      }
      await assertFuelStillPlain();
      // Kept even though both are signed: if the page dies between the two
      // broadcasts, resuming only has to send the reveal.
      savePendingReveal(pending(commitTxid, raw.commit, raw.reveal));
      onStep("broadcast-commit");
      await opts.broadcast(raw.commit);
      onStep("broadcast-reveal");
      const revealTxid = await opts.broadcast(raw.reveal);
      clearPendingReveal(address);
      onStep("done");
      return { commitTxid, revealTxid };
    }
  }

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

  await assertFuelStillPlain();
  // From here the commit's BTC can only come back through this envelope.
  savePendingReveal(pending(commitTxid, commitRawTx));
  onStep("broadcast-commit");
  await opts.broadcast(commitRawTx);

  const revealTxid = await signAndBroadcastReveal({
    address,
    reveal: revealFor(commitTxid).psbtHex,
    signPsbt: opts.signPsbt,
    broadcast: opts.broadcast,
    onStep,
  });
  clearPendingReveal(address);
  onStep("done");
  return { commitTxid, revealTxid };
}

async function signAndBroadcastReveal(opts: {
  address: string;
  reveal: string;
  signPsbt: SignPsbt;
  broadcast: (hex: string) => Promise<string>;
  onStep: (step: InscribeStep) => void;
}): Promise<string> {
  opts.onStep("sign-reveal");
  const signedReveal = await opts.signPsbt(opts.reveal, { [opts.address]: [0] });
  assertSameTransaction(readPsbt(opts.reveal), readPsbt(signedReveal));
  const revealRawTx = finalizeSignedPsbt(signedReveal);
  assertSameTransaction(readPsbt(opts.reveal), readTransaction(revealRawTx));
  opts.onStep("broadcast-reveal");
  return opts.broadcast(revealRawTx);
}

/**
 * What resuming came to: the launch's reveal is out, or the commit can never
 * confirm and the kept record was dropped.
 */
export type ResumeResult =
  | { outcome: "launched"; commitTxid: string; revealTxid: string }
  | { outcome: "abandoned"; commitTxid: string; spentBy: string };

/**
 * Finish a launch whose commit went out and whose reveal did not: rebuild the
 * reveal from the kept envelope and ask the wallet to sign it (or send the
 * one it already signed), then broadcast. A commit output already spent means
 * the reveal made it after all: the record is cleared and nothing is asked.
 * A commit the node does not know whose funding was since spent by another
 * confirmed transaction can never confirm: the record is cleared, nothing is
 * broadcast, and the result says so.
 */
export async function resumeInscribeLaunch(opts: {
  record: PendingReveal;
  signPsbt: SignPsbt;
  broadcast: (hex: string) => Promise<string>;
  onStep: (step: InscribeStep) => void;
}): Promise<ResumeResult> {
  const { record, onStep } = opts;
  onStep("preparing");
  if (record.recipient !== BURN_ADDRESS) {
    throw new WalletSdkError("invalid_argument", "Kept reveal pays somewhere other than the burn address");
  }
  const reveal = buildRevealPsbt({
    pubkey: taprootPubkey(record.address),
    commitTxid: record.commitTxid,
    commitVout: record.commitVout,
    commitAmount: record.commitAmount,
    revealScript: hexCodec.decode(record.revealScript),
    tapInternalKey: hexCodec.decode(record.tapInternalKey),
    feeRate: record.feeRate,
    recipientAddress: record.recipient,
  });
  // The kept commit must pay exactly the output this envelope unlocks, or the
  // reveal built from it spends nothing.
  const commit = readTransaction(record.commitRawTx);
  const spends = readPsbt(reveal.psbtHex).getInput(0).witnessUtxo;
  const paid = record.commitVout < commit.outputsLength ? commit.getOutput(record.commitVout) : undefined;
  if (commit.id !== record.commitTxid || !spends || !paid?.script
    || hexCodec.encode(paid.script) !== hexCodec.encode(spends.script) || paid.amount !== spends.amount) {
    throw new WalletSdkError("transaction_mismatch", "Kept commit does not pay this envelope");
  }
  if (record.revealRawTx) {
    assertSameTransaction(readPsbt(reveal.psbtHex), readTransaction(record.revealRawTx));
  }

  const outspend = await commitOutspend(record.commitTxid, record.commitVout);
  if (outspend.spent) {
    clearPendingReveal(record.address);
    onStep("done");
    return { outcome: "launched", commitTxid: record.commitTxid, revealTxid: outspend.txid };
  }
  if (!outspend.known) {
    // Neither confirmed nor in the mempool. If a coin the commit spends has
    // since confirmed in another transaction, the commit can never confirm,
    // no BTC waits behind it, and the record would only block this address.
    const spentBy = await fundingSpentElsewhere(commit, record.commitTxid);
    if (spentBy !== null) {
      clearPendingReveal(record.address);
      return { outcome: "abandoned", commitTxid: record.commitTxid, spentBy };
    }
    // The page died before the commit reached the network. Its funding input
    // is still unspent or the broadcast fails, so sending it now is the same
    // launch, just later.
    onStep("broadcast-commit");
    await opts.broadcast(record.commitRawTx);
  }

  let revealTxid: string;
  if (record.revealRawTx) {
    onStep("broadcast-reveal");
    revealTxid = await opts.broadcast(record.revealRawTx);
  } else {
    revealTxid = await signAndBroadcastReveal({
      address: record.address,
      reveal: reveal.psbtHex,
      signPsbt: opts.signPsbt,
      broadcast: opts.broadcast,
      onStep,
    });
  }
  clearPendingReveal(record.address);
  onStep("done");
  return { outcome: "launched", commitTxid: record.commitTxid, revealTxid };
}

/**
 * The confirmed transaction that spent one of the commit's inputs instead of
 * the commit, or null. Only a confirmed spend counts: a conflict still in the
 * mempool can be evicted or replaced, and then the kept commit is good again.
 * An input whose status cannot be read is not evidence either way.
 */
async function fundingSpentElsewhere(commit: Transaction, commitTxid: string): Promise<string | null> {
  for (let i = 0; i < commit.inputsLength; i++) {
    const input = commit.getInput(i);
    if (!input.txid || input.index === undefined) continue;
    try {
      const res = await fetch(`${ELECTRS_API_BASE}/tx/${hexCodec.encode(input.txid)}/outspend/${input.index}`);
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      const data = (await res.json()) as { spent?: unknown; txid?: unknown; status?: { confirmed?: unknown } };
      if (
        data.spent === true &&
        typeof data.txid === "string" && /^[0-9a-f]{64}$/.test(data.txid) &&
        data.txid !== commitTxid &&
        data.status?.confirmed === true
      ) {
        return data.txid;
      }
    } catch {
      // Unreadable: keep the record.
    }
  }
  return null;
}

/** Whether the node knows the commit, and whether its output is spent (and by what). */
async function commitOutspend(
  txid: string,
  vout: number,
): Promise<{ known: boolean; spent: false } | { known: true; spent: true; txid: string }> {
  const status = await fetch(`${ELECTRS_API_BASE}/tx/${txid}/status`);
  await status.body?.cancel().catch(() => undefined);
  if (status.status === 404 || status.status === 400) return { known: false, spent: false };
  if (!status.ok) throw new WalletSdkError("network", `Could not read the commit: HTTP ${status.status}`);
  const res = await fetch(`${ELECTRS_API_BASE}/tx/${txid}/outspend/${vout}`);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new WalletSdkError("network", `Could not read the commit output: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { spent?: unknown; txid?: unknown };
  if (data.spent !== true) return { known: true, spent: false };
  if (typeof data.txid !== "string" || !/^[0-9a-f]{64}$/.test(data.txid)) {
    throw new WalletSdkError("invalid_response", "Invalid commit outspend");
  }
  return { known: true, spent: true, txid: data.txid };
}
