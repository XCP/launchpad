#!/usr/bin/env node
/**
 * Record a reward batch that has actually been sent.
 *
 * The manifest says what SHOULD have been paid; the chain says what was. This writes the batch
 * only where the two agree, and links every payout to the transaction that carried it — which is
 * what turns programme accounting into something a profile page may show. Until a payout points
 * at a real row in reward_transactions the public UI treats it as a promise, which is the whole
 * design of migration 0017.
 *
 * Usage:
 *   node scripts/record-reward-batch.mjs --manifest <path> --source <address> [--id <batch-id>]
 *                                        [--execute]
 *
 * Writes SQL next to the manifest and prints it. Without --execute nothing touches D1, so the
 * statements can be read before they are run.
 *
 * REFUSES RATHER THAN GUESSES
 *
 * A recipient paid the wrong amount, or not at all, stops the whole batch. Recording a partial
 * distribution as complete is the one outcome with no cheap remedy: reward_batch_mints keys on the
 * mint transaction for the lifetime of the programme, so a mint written into a batch can never be
 * paid again, and a batch recorded early would strand whoever it missed.
 *
 * Everything is INSERT OR IGNORE or an idempotent upsert, so a re-run after adding confirmations
 * updates what changed and repeats nothing.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CP = "https://api.counterparty.io:4000/v2";
const MEMPOOL = "https://mempool.space/api";
const DB = "launchpad-db";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const manifestPath = arg("manifest");
const source = arg("source");
const execute = process.argv.includes("--execute");

if (!manifestPath || !source) {
  console.error("usage: node scripts/record-reward-batch.mjs --manifest <path> --source <address> [--id <batch-id>] [--execute]");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const batchId = arg("id", `${manifest.asset.toLowerCase()}-${String(manifest.first_mint_number).padStart(4, "0")}-${manifest.cutoff_mint_number}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(2_000 * (attempt + 1));
    }
  }
}

/** Every MINTS send this address has made, confirmed and unconfirmed, per destination. */
async function paidByChain(asset) {
  const paid = new Map();
  const add = (destination, quantity, txid, confirmed) => {
    const prior = paid.get(destination) ?? { quantity: 0n, txids: new Set(), confirmed: true };
    prior.quantity += BigInt(quantity);
    prior.txids.add(txid);
    prior.confirmed = prior.confirmed && confirmed;
    paid.set(destination, prior);
  };

  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const data = await json(`${CP}/addresses/${source}/sends?limit=1000${cursor ? `&cursor=${cursor}` : ""}`);
    for (const send of data.result ?? []) {
      if (send.source === source && send.asset === asset && send.status === "valid") {
        add(send.destination, send.quantity, send.tx_hash, true);
      }
    }
    cursor = data.next_cursor;
    if (!cursor) break;
  }

  cursor = null;
  for (let page = 0; page < 30; page++) {
    const data = await json(`${CP}/mempool/events?limit=1000${cursor ? `&cursor=${cursor}` : ""}`);
    for (const event of data.result ?? []) {
      // ENHANCED_SEND is an individual send and MPMA_SEND one leg of a batch. Both pay somebody,
      // and asking only for "SEND" finds neither — a mistake made once already this week.
      if (event.event !== "ENHANCED_SEND" && event.event !== "MPMA_SEND") continue;
      const p = event.params ?? {};
      if (p.source === source && p.asset === asset) add(p.destination, p.quantity, event.tx_hash, false);
    }
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return paid;
}

const sql = (value) => (value === null || value === undefined ? "NULL" : `'${String(value).replace(/'/g, "''")}'`);

console.log(`batch ${batchId} — ${manifest.eligible_mints} mints, ${manifest.recipient_count} recipients`);
console.log("reading the chain…");
const paid = await paidByChain(manifest.asset);

/* Verify before writing anything. */
const problems = [];
for (const payout of manifest.payouts) {
  const actual = paid.get(payout.address)?.quantity ?? 0n;
  const expected = BigInt(payout.quantity);
  if (actual !== expected) {
    problems.push(`${payout.address} expected ${expected} but chain shows ${actual}`);
  }
  const txids = paid.get(payout.address)?.txids ?? new Set();
  if (txids.size > 1) {
    problems.push(`${payout.address} was paid by ${txids.size} transactions; cannot attribute one`);
  }
}
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) — nothing written:`);
  for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
  if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`);
  console.error("\nA batch recorded while incomplete cannot be re-paid: reward_batch_mints keys on the");
  console.error("mint transaction for the life of the programme. Fix the sends, then run this again.");
  process.exit(2);
}
console.log(`all ${manifest.payouts.length} payouts match the chain exactly`);

/* Each transaction's method, fee and confirmation. */
const txids = new Set();
for (const payout of manifest.payouts) for (const txid of paid.get(payout.address).txids) txids.add(txid);
console.log(`resolving ${txids.size} transactions…`);

const recipientsPerTx = new Map();
for (const payout of manifest.payouts) {
  const txid = [...paid.get(payout.address).txids][0];
  recipientsPerTx.set(txid, (recipientsPerTx.get(txid) ?? 0) + 1);
}

const transactions = [];
for (const txid of txids) {
  const tx = await json(`${MEMPOOL}/tx/${txid}`);
  transactions.push({
    txid,
    // One transaction paying several people is an MPMA by construction; there is no other way to
    // do it, so the recipient count is a sounder test than parsing the message type back out.
    method: recipientsPerTx.get(txid) > 1 ? "mpma" : "enhanced_send",
    status: tx.status?.confirmed ? "confirmed" : "broadcast",
    fee: tx.fee ?? null,
    block: tx.status?.confirmed ? tx.status.block_height : null,
  });
}
const confirmed = transactions.filter((t) => t.status === "confirmed").length;
console.log(`  ${confirmed} confirmed, ${transactions.length - confirmed} still in the mempool`);

/* A valuation snapshot: what the distribution meant at the moment it was recorded. */
let xcpUsd = null;
let btcUsd = null;
try {
  const price = await json("https://api.xcp.io/v2/price");
  xcpUsd = price?.result?.xcp?.usd ?? null;
  btcUsd = price?.result?.btc?.usd ?? null;
} catch {
  // Decoration. A batch is not worth failing over a price feed.
}

const batchStatus = confirmed === transactions.length ? "confirmed" : "broadcast";
const statements = [];

statements.push(
  `INSERT INTO reward_batches (id, asset, reward_per_mint, first_mint_number, cutoff_mint_number,
     cutoff_block, cutoff_tx_index, cutoff_tx_hash, eligible_mints, recipient_count, total_quantity,
     manifest_sha256, status, xcp_usd, btc_usd, broadcast_at, confirmed_at)
   VALUES (${sql(batchId)}, ${sql(manifest.asset)}, ${sql(manifest.reward_per_mint)},
     ${manifest.first_mint_number}, ${manifest.cutoff_mint_number}, ${manifest.cutoff_block},
     ${manifest.cutoff_tx_index}, ${sql(manifest.cutoff_tx_hash)}, ${manifest.eligible_mints},
     ${manifest.recipient_count}, ${sql(manifest.total_quantity)}, ${sql(manifest.manifest_sha256)},
     ${sql(batchStatus)}, ${xcpUsd ?? "NULL"}, ${btcUsd ?? "NULL"}, unixepoch(),
     ${batchStatus === "confirmed" ? "unixepoch()" : "NULL"})
   ON CONFLICT(id) DO UPDATE SET
     status = excluded.status,
     confirmed_at = excluded.confirmed_at
   WHERE reward_batches.status IS NOT excluded.status;`,
);

// The evidence. Append-only and keyed on the mint transaction, so a mint can belong to exactly one
// batch for the lifetime of the programme however many times this runs.
for (const mint of manifest.mints) {
  statements.push(
    `INSERT OR IGNORE INTO reward_batch_mints (mint_tx_hash, batch_id, source, launch_tx, block_index, tx_index, reward_quantity)
     VALUES (${sql(mint.tx_hash)}, ${sql(batchId)}, ${sql(mint.source)}, ${sql(mint.launch_tx)},
       ${mint.block_index}, ${mint.tx_index}, ${sql(manifest.reward_per_mint)});`,
  );
}

for (const tx of transactions) {
  statements.push(
    `INSERT INTO reward_transactions (tx_hash, batch_id, method, status, btc_fee_sats, confirmed_block, confirmed_at)
     VALUES (${sql(tx.txid)}, ${sql(batchId)}, ${sql(tx.method)}, ${sql(tx.status)},
       ${tx.fee ?? "NULL"}, ${tx.block ?? "NULL"}, ${tx.block ? "unixepoch()" : "NULL"})
     ON CONFLICT(tx_hash) DO UPDATE SET
       status = excluded.status,
       confirmed_block = excluded.confirmed_block,
       confirmed_at = excluded.confirmed_at
     WHERE reward_transactions.status IS NOT excluded.status
        OR reward_transactions.confirmed_block IS NOT excluded.confirmed_block;`,
  );
}

const statusByTx = new Map(transactions.map((t) => [t.txid, t.status]));
for (const payout of manifest.payouts) {
  const txid = [...paid.get(payout.address).txids][0];
  const status = statusByTx.get(txid) === "confirmed" ? "confirmed" : "broadcast";
  statements.push(
    `INSERT INTO reward_payouts (batch_id, address, mint_count, quantity, reward_tx_hash, status)
     VALUES (${sql(batchId)}, ${sql(payout.address)}, ${payout.mint_count}, ${sql(payout.quantity)},
       ${sql(txid)}, ${sql(status)})
     ON CONFLICT(batch_id, address) DO UPDATE SET
       reward_tx_hash = excluded.reward_tx_hash,
       status = excluded.status
     WHERE reward_payouts.status IS NOT excluded.status
        OR reward_payouts.reward_tx_hash IS NOT excluded.reward_tx_hash;`,
  );
}

const sqlPath = join(dirname(manifestPath), `record-${batchId}.sql`);
writeFileSync(sqlPath, statements.join("\n") + "\n");
console.log(`\n${statements.length} statements written to ${sqlPath}`);
console.log(`  1 batch · ${manifest.mints.length} mint rows · ${transactions.length} transactions · ${manifest.payouts.length} payouts`);
console.log(`  batch status: ${batchStatus}${xcpUsd ? ` · XCP $${xcpUsd}` : ""}`);

if (!execute) {
  console.log("\nnothing written to D1 — re-run with --execute");
  process.exit(0);
}

console.log("\nexecuting against D1…");
const out = execSync(`npx wrangler d1 execute ${DB} --remote --file="${sqlPath}"`, {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"],
});
console.log(out.split("\n").slice(-12).join("\n"));
