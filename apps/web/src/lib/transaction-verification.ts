import { base64, hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { WalletSdkError } from "@xcp/wallet-sdk";

export const TX_VERIFICATION_OPTIONS = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
} as const;

export function readTransaction(raw: string): Transaction {
  try {
    const transaction = Transaction.fromRaw(hex.decode(raw), TX_VERIFICATION_OPTIONS);
    if (!transaction.inputsLength || !transaction.outputsLength) throw new Error("Empty transaction");
    return transaction;
  } catch (cause) {
    throw new WalletSdkError("invalid_response", "Invalid transaction bytes", { cause });
  }
}

export function readPsbt(encoded: string): Transaction {
  try {
    const bytes = /^[0-9a-f]+$/i.test(encoded) && encoded.length % 2 === 0
      ? hex.decode(encoded) : base64.decode(encoded);
    const transaction = Transaction.fromPSBT(bytes, TX_VERIFICATION_OPTIONS);
    if (!transaction.inputsLength || !transaction.outputsLength) throw new Error("Empty transaction");
    return transaction;
  } catch (cause) {
    throw new WalletSdkError("invalid_response", "Invalid PSBT bytes", { cause });
  }
}

/** Bitcoin-envelope check, matching the SDK pipeline's internal verifier.
 * Only signatures may change. This does not decode a Counterparty message. */
export function assertSameTransaction(expected: Transaction, actual: Transaction): void {
  if (hex.encode(expected.unsignedTx) !== hex.encode(actual.unsignedTx)) {
    throw new WalletSdkError("transaction_mismatch", "Transaction inputs, outputs or amounts changed");
  }
}
