#!/usr/bin/env node
/**
 * Send the individual half of a reward batch, one Counterparty send per row.
 *
 * The MPMA covers every address it can encode; this covers the rest — Taproot and P2WSH, which an
 * MPMA cannot reach — and there is no batching available for them, so it is one transaction each.
 * Doing 75 of those by hand is where mistakes come from, which is what this exists to remove.
 *
 * Usage:
 *   node scripts/send-rewards.mjs --csv <path> --source <address> [--limit N] [--fee-rate N]
 *                                 [--dry-run]
 *
 * The mnemonic is read from a hidden prompt and never touches argv, the environment, or disk.
 * Passing it as a flag would put it in shell history and in the process table; there is
 * deliberately no flag to do so.
 *
 * SAFETY: THE ADDRESS IS THE PROOF
 *
 * Nothing is signed until the derived key reproduces `--source` exactly. That single check is what
 * makes the rest safe: a mistyped word, the wrong wallet, a wrong derivation path, or a bug in the
 * ported Counterwallet seed code all fail the comparison, and the script stops having signed
 * nothing. A wrong key cannot quietly sign for somewhere else.
 *
 * IDEMPOTENCE
 *
 * The CSV is the ledger and it is written before the risky step, not after. A row moves to PENDING
 * with its txid the moment the transaction is signed — which is when the txid becomes known and
 * before the broadcast that could succeed while this process dies — and to SENT once broadcast is
 * acknowledged. On a later run a PENDING row is checked against the chain: found means SENT,
 * absent means it never landed and may be retried. So a crash at the worst possible moment costs a
 * lookup, never a double payment.
 *
 * THE 25-TRANSACTION WALL
 *
 * Each send spends the change of the one before it, so they form an unconfirmed chain, and Bitcoin
 * relays at most 25 unconfirmed ancestors or descendants in a package. The 26th is simply rejected
 * — "too-long-mempool-chain" — and a run that ignored this would fail every remaining row in a
 * burst. So the depth is measured before each send and the run waits for a confirmation when it
 * gets close, which on a normal fee rate means waiting for the next block.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import * as btc from "@scure/btc-signer";
import { HDKey } from "@scure/bip32";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { COUNTERWALLET_PATH, getCounterwalletSeed, isValidCounterwalletMnemonic } from "./lib/counterwallet.mjs";

const CP = "https://api.counterparty.io:4000/v2";
const MEMPOOL = "https://mempool.space/api";
const SATS = 100_000_000n;

/** Bitcoin relays at most 25 unconfirmed ancestors/descendants. Stopping at 20 leaves room for
 *  the change chain to be a little deeper than this address's own transaction count suggests. */
const CHAIN_LIMIT = 20;
/** How many addresses to search before concluding the mnemonic is not the one. Counterwallet
 *  wallets number their addresses from zero and nobody has thousands. */
const ADDRESS_SCAN = 50;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const csvPath = arg("csv");
const source = arg("source");
const limit = Number(arg("limit", "0")) || Infinity;
const feeRate = Number(arg("fee-rate", "2"));
const dryRun = flag("dry-run");
/** Reconcile the file against the chain and stop. No key is asked for, so this is the safe way
 *  to repair markings — including from a machine that should never see the mnemonic. */
const reconcileOnly = flag("reconcile-only");

if (!csvPath || !source) {
  console.error("usage: node scripts/send-rewards.mjs --csv <path> --source <address> [--limit N] [--fee-rate N] [--dry-run] [--reconcile-only]");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, { retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        // The public node rate limits. Backing off is the whole handling; there is nothing else
        // to try, and giving up would strand the run halfway through a batch.
        await sleep(2_000 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return text;
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(2_000 * (attempt + 1));
    }
  }
  throw new Error(`gave up on ${url}`);
}

const apiJson = async (url, opts) => JSON.parse(await api(url, opts));

/* ------------------------------------------------------------------ */
/* The CSV, which is also the ledger                                   */
/* ------------------------------------------------------------------ */

/**
 * Rows plus the raw header, so writing back preserves whatever shape the file arrived in.
 * Status and txid live in columns 4 and 5; a file that has neither simply grows them.
 */
function readRows(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const header = lines[0];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const [address, asset, quantity, status = "", txid = ""] = line.split(",").map((c) => c.trim());
    rows.push({ address, asset, quantity, status: status.toUpperCase(), txid, lineNumber: i + 1 });
  }
  return { header, rows };
}

/** Written after every state change, not at the end: an interrupted run must leave a file that
 *  says exactly what happened. */
function writeRows(path, header, rows) {
  const body = rows.map((r) => [r.address, r.asset, r.quantity, r.status, r.txid].join(","));
  writeFileSync(path, [header, ...body].join("\n") + "\n");
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

/** Read a secret without echoing it, and without it reaching argv or the environment. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl.output;
    let muted = false;
    output.write(question);
    // Replace the writer rather than the stream: readline still needs to emit its own newline.
    const write = output.write.bind(output);
    output.write = (chunk, ...rest) => (muted ? true : write(chunk, ...rest));
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      output.write = write;
      output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * The key for `source`, found by walking this mnemonic's own addresses.
 *
 * Throws rather than returning null. There is no sensible way to continue without the key, and
 * failing here means nothing has been signed — which is the entire safety argument for the
 * ported seed derivation in lib/counterwallet.mjs.
 */
function findKey(mnemonic, expectedAddress) {
  if (!isValidCounterwalletMnemonic(mnemonic)) {
    throw new Error("That is not a valid Counterwallet mnemonic (every word must be in its 1626-word list, in a multiple of three).");
  }
  const root = HDKey.fromMasterSeed(getCounterwalletSeed(mnemonic));
  for (let index = 0; index < ADDRESS_SCAN; index++) {
    const child = root.derive(`${COUNTERWALLET_PATH}/${index}`);
    if (btc.p2pkh(child.publicKey).address === expectedAddress) {
      return { privateKey: child.privateKey, publicKey: child.publicKey, index };
    }
  }
  throw new Error(
    `This mnemonic does not produce ${expectedAddress} in its first ${ADDRESS_SCAN} addresses. ` +
      `Nothing has been signed. Check the phrase, and that the address really is a Counterwallet one.`,
  );
}

/* ------------------------------------------------------------------ */
/* Chain state                                                         */
/* ------------------------------------------------------------------ */

/** Unconfirmed transactions this address already has in flight. */
async function chainDepth(address) {
  try {
    const txs = JSON.parse(await api(`${MEMPOOL}/address/${address}/txs/mempool`));
    return Array.isArray(txs) ? txs.length : 0;
  } catch {
    // Unknown is not zero, but treating it as zero only risks one rejected transaction, and
    // stalling the whole run because a block explorer blinked is worse.
    return 0;
  }
}

/**
 * Every send of one asset already made from this address, confirmed or still unconfirmed,
 * summed per destination.
 *
 * This is what makes the run safe to re-run against a file whose markings are stale, missing, or
 * simply wrong — the chain is asked, not the spreadsheet.
 *
 * The mempool half is the half that is easy to get wrong, and I got it wrong first: an individual
 * Counterparty send is an ENHANCED_SEND event, not a SEND. Asking for `mempool/events/SEND`
 * returns zero and reads exactly like "nothing has been sent", which is the most dangerous wrong
 * answer available here — it would re-send to somebody already paid. MPMA_SEND is included for
 * the same reason: a destination covered by the batch MPMA must not be paid twice.
 *
 * Both feeds are paginated to exhaustion. The MPMA alone puts 158 events in the mempool, so a
 * single page is emphatically not the universe.
 */
async function sendsAlreadyMade(address, asset) {
  const byDestination = new Map();
  const record = (destination, quantity, txid, confirmed) => {
    const prior = byDestination.get(destination) ?? { quantity: 0n, txid: null, confirmed: false };
    byDestination.set(destination, {
      quantity: prior.quantity + BigInt(quantity),
      txid: prior.txid ?? txid,
      confirmed: prior.confirmed || confirmed,
    });
  };

  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const { result, next_cursor } = await apiJson(
      `${CP}/addresses/${address}/sends?limit=1000${cursor ? `&cursor=${cursor}` : ""}`,
    );
    for (const send of result ?? []) {
      if (send.source === address && send.asset === asset && send.status === "valid") {
        record(send.destination, send.quantity, send.tx_hash, true);
      }
    }
    cursor = next_cursor;
    if (!cursor) break;
  }

  cursor = null;
  for (let page = 0; page < 30; page++) {
    const { result, next_cursor } = await apiJson(
      `${CP}/mempool/events?limit=1000${cursor ? `&cursor=${cursor}` : ""}`,
    );
    for (const event of result ?? []) {
      if (event.event !== "ENHANCED_SEND" && event.event !== "MPMA_SEND") continue;
      const p = event.params ?? {};
      if (p.source === address && p.asset === asset) {
        record(p.destination, p.quantity, event.tx_hash, false);
      }
    }
    cursor = next_cursor;
    if (!cursor) break;
  }

  return byDestination;
}

/** True once this transaction exists anywhere a node will admit to. */
async function txExists(txid) {
  try {
    const res = await fetch(`${MEMPOOL}/tx/${txid}`, { signal: AbortSignal.timeout(20_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForRoom(address) {
  let depth = await chainDepth(address);
  if (depth < CHAIN_LIMIT) return;
  console.log(`  chain is ${depth} deep; waiting for a block before continuing`);
  while (depth >= CHAIN_LIMIT) {
    await sleep(60_000);
    depth = await chainDepth(address);
    console.log(`  ...${depth} unconfirmed`);
  }
}

/* ------------------------------------------------------------------ */
/* Compose, sign, broadcast                                            */
/* ------------------------------------------------------------------ */

async function compose(row) {
  const quantity = (BigInt(row.quantity) * SATS).toString();
  const url =
    `${CP}/addresses/${source}/compose/send` +
    `?destination=${encodeURIComponent(row.address)}&asset=${encodeURIComponent(row.asset)}` +
    `&quantity=${quantity}&verbose=true&sat_per_vbyte=${feeRate}`;
  const { result } = await apiJson(url);
  if (!result?.rawtransaction) throw new Error("compose returned no transaction");
  return result;
}

/**
 * Sign every input of a composed transaction.
 *
 * Built from `rawtransaction` rather than the `psbt` the same response carries: that PSBT arrives
 * with a placeholder `finalScriptSig` and no UTXO for its inputs, so it reads as already finalized
 * and cannot be signed as-is.
 *
 * A legacy input needs the whole previous transaction, not just its output — the sighash covers
 * the prevout script, and @scure/btc-signer insists on `nonWitnessUtxo` for exactly that reason.
 * So each one is fetched. `input.txid` is already in display order here; reversing it, which the
 * serialized form would suggest, silently asks for a transaction that does not exist.
 */
async function signComposed(result, key) {
  const tx = btc.Transaction.fromRaw(hexToBytes(result.rawtransaction), {
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
    disableScriptCheck: true,
  });
  for (let i = 0; i < tx.inputsLength; i++) {
    const txid = bytesToHex(tx.getInput(i).txid);
    const prevHex = await api(`${MEMPOOL}/tx/${txid}/hex`);
    tx.updateInput(i, { nonWitnessUtxo: hexToBytes(prevHex.trim()) });
  }
  tx.sign(key.privateKey);
  tx.finalize();
  return { hex: bytesToHex(tx.extract()), txid: tx.id };
}

async function broadcast(hex) {
  const res = await fetch(`${MEMPOOL}/tx`, {
    method: "POST",
    body: hex,
    signal: AbortSignal.timeout(30_000),
  });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(text.slice(0, 300));
  return text;
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

const { header, rows } = readRows(csvPath);
const asset = rows[0]?.asset ?? "MINTS";

console.log(`${csvPath}`);
console.log(`  ${rows.length} rows · reconciling against the chain…`);

// The chain decides, not the file. Markings can be stale, missing, or simply wrong, and the one
// mistake that matters here is paying somebody twice — so every row is checked against what this
// address has actually sent, confirmed AND unconfirmed, before anything is queued.
const already = await sendsAlreadyMade(source, asset);

let healed = 0;
for (const row of rows) {
  const expected = BigInt(row.quantity) * SATS;
  const found = already.get(row.address);
  if (found && found.quantity >= expected) {
    // Broadcast but unconfirmed is PENDING, which is the same state this script writes between
    // signing and acknowledgement — a transaction that exists and has not settled.
    const status = found.confirmed ? "SENT" : "PENDING";
    if (row.status !== status || (!row.txid && found.txid)) healed++;
    row.status = status;
    row.txid = row.txid || found.txid || "";
    continue;
  }
  if (found && found.quantity > 0n) {
    // Paid, but not the right amount. Refusing to guess: topping up automatically could as
    // easily be doubling a payment that was simply recorded oddly.
    console.error(
      `  ATTENTION ${row.address.slice(0, 20)}… expects ${row.quantity} ${asset} but has already ` +
        `received ${Number(found.quantity / SATS)}. Left alone; decide by hand.`,
    );
    row.status = "REVIEW";
    healed++;
    continue;
  }
  // Nothing on chain. A row previously marked SENT or PENDING was not, so clear it.
  if (row.status === "SENT" || row.status === "PENDING") {
    console.log(`  ${row.address.slice(0, 20)}… was marked ${row.status} but nothing is on chain; will retry`);
    healed++;
  }
  row.status = "";
  row.txid = "";
}
if (healed > 0) writeRows(csvPath, header, rows);

const counts = { SENT: 0, PENDING: 0, REVIEW: 0, todo: 0 };
for (const row of rows) counts[row.status || "todo"]++;
console.log(
  `  ${counts.SENT} confirmed · ${counts.PENDING} in mempool · ${counts.REVIEW} needs review · ${counts.todo} to send`,
);

if (reconcileOnly) {
  console.log("\nreconcile only — file updated, nothing sent");
  process.exit(0);
}

const queue = rows.filter((r) => r.status === "").slice(0, limit === Infinity ? undefined : limit);
if (queue.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

const totalMints = queue.reduce((sum, r) => sum + Number(r.quantity), 0);
console.log(`\nabout to send ${queue.length} transactions totalling ${totalMints.toLocaleString("en-US")} ${queue[0].asset}`);
console.log(`from ${source} at ${feeRate} sat/vB${dryRun ? " (dry run — nothing will be broadcast)" : ""}\n`);

const mnemonic = await promptHidden("Counterwallet mnemonic (hidden): ");
const key = findKey(mnemonic.trim(), source);
console.log(`key matches ${source} at ${COUNTERWALLET_PATH}/${key.index}\n`);

let sent = 0;
let failed = 0;
for (const row of queue) {
  const label = `${row.address.slice(0, 16)}… ${Number(row.quantity).toLocaleString("en-US")} ${row.asset}`;
  try {
    await waitForRoom(source);
    const composed = await compose(row);
    const signed = await signComposed(composed, key);

    if (dryRun) {
      console.log(`DRY  ${label} → would be ${signed.txid} (fee ${composed.btc_fee} sats)`);
      continue;
    }

    // Written BEFORE the broadcast: from here on the transaction may exist whether or not this
    // process survives to hear about it.
    row.status = "PENDING";
    row.txid = signed.txid;
    writeRows(csvPath, header, rows);

    await broadcast(signed.hex);
    row.status = "SENT";
    writeRows(csvPath, header, rows);
    sent++;
    console.log(`SENT ${label} → ${signed.txid} (fee ${composed.btc_fee} sats)`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${label}: ${message}`);
    // A rejected chain is the one failure worth stopping for: everything after it fails the same
    // way, and a hundred identical errors bury the one that mattered.
    if (/too-long-mempool-chain|too many/i.test(message)) {
      console.error("stopping: the mempool chain is full. Re-run after a block confirms.");
      break;
    }
  }
}

console.log(`\n${sent} sent, ${failed} failed, ${rows.filter((r) => r.status !== "SENT").length} still to do`);
