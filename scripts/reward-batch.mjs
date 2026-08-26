#!/usr/bin/env node
/**
 * Build the payout manifest for a MINTS reward batch.
 *
 * Reads the first N eligible mints from D1 in the programme's canonical order,
 * sums them per address, and writes the two CSVs the send actually needs plus
 * a manifest to freeze against.
 *
 * Read-only. Nothing here writes to D1 or broadcasts anything — the operator
 * sends by hand from the wallet extension, and the payouts are recorded
 * afterwards from what actually landed on chain.
 *
 * Usage:
 *   node scripts/reward-batch.mjs --cutoff 1000 [--out dist/reward-batch-1]
 *
 * WHY TWO FILES
 *
 * Counterparty refuses an MPMA send to any address whose packed form exceeds
 * 22 bytes (lib/messages/versions/mpma.py: "Address not supported by MPMA
 * send"). Packing is one version byte plus the payload, so a 20-byte witness
 * program packs to 21 and fits, while a 32-byte one packs to 33 and does not.
 * That excludes P2TR *and* P2WSH — not just taproot, which is the trap: today
 * this data has no P2WSH, so a bc1p check would pass and then break on the
 * first batch that does. This tests the packed length, like core does.
 *
 * QUANTITY UNITS
 *
 * Raw satoshi units, not whole MINTS. The extension's CSV importer passes the
 * quantity string through to the compose API untouched, and core requires
 * integer satoshis; the review screen is what divides by 1e8 for display. So
 * 100 MINTS is written here as 10000000000, and the extension should show
 * "100.00000000 MINTS" per send. That display is the operator's check that
 * these units are right — if it reads 100 MINTS as 0.000001, stop.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Raw divisible MINTS per eligible mint. Mirrors REWARD_PER_MINT_RAW in
 *  apps/api/src/queries/rewards.ts — the two must not drift. */
const REWARD_PER_MINT_RAW = 10_000_000_000n;
const ASSET = "MINTS";
const DB = "launchpad-db";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const cutoff = Number(arg("cutoff", "1000"));
const outDir = arg("out", join("dist", `reward-batch-${cutoff}`));
if (!Number.isInteger(cutoff) || cutoff < 1) {
  console.error("--cutoff must be a positive integer");
  process.exit(1);
}

/**
 * The programme's canonical order, and the reason it is spelled out in full
 * here rather than trusted to arrive sorted: entitlement is "the first N
 * conforming mints globally", so the tie-break has to be total and stable or
 * two runs of this script could disagree about who is inside the cutoff.
 * block, then tx_index, then tx_hash — the same order apps/api uses.
 */
const SQL = [
  "WITH eligible AS (",
  "SELECT m.tx_hash, m.source, m.launch_tx, m.block_index, m.tx_index",
  "FROM launch_mints m",
  "JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1",
  "ORDER BY m.block_index, COALESCE(m.tx_index, 0), m.tx_hash",
  `LIMIT ${cutoff})`,
  "SELECT tx_hash, source, launch_tx, block_index, COALESCE(tx_index, 0) AS tx_index",
  "FROM eligible ORDER BY block_index, tx_index, tx_hash",
].join(" ");

/**
 * --command, and deliberately without a shell.
 *
 * Two dead ends are worth recording so nobody walks back into them. `--file`
 * uploads the SQL and answers with a SUMMARY -- "Total queries executed",
 * "Rows read" -- not the rows, so it cannot be used to read anything. And
 * passing a multi-word --command through `shell: true` on Windows lets the
 * shell re-split it on spaces, at which point wrangler reports the option
 * missing entirely. With shell disabled the argument arrives whole, which is
 * also why the query below is one line: nothing has to survive quoting.
 */
function query(sql) {
  // execSync with one quoted string, rather than execFileSync: resolving
  // `npx` across Git Bash and cmd from Node is the part that keeps failing,
  // and a single shell string sidesteps it. Safe to quote naively because the
  // SQL is a constant assembled here -- no user input reaches it, and the only
  // interpolation is `cutoff`, validated as a positive integer above.
  const out = execSync(
    `npx wrangler d1 execute ${DB} --remote --json --command "${sql}"`,
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  // wrangler prints progress lines first; the payload starts at the first
  // bracket that begins a line.
  return JSON.parse(out.slice(out.search(/^\[/m)))[0].results;
}

/**
 * Whether Counterparty can encode this destination inside an MPMA send.
 *
 * Mirrors core's rule — packed length must be 22 bytes or less — rather than
 * matching on an address prefix. Base58 (P2PKH/P2SH) packs to 21. A bech32
 * address packs to one version byte plus its witness program, so the question
 * is only how long that program is, which the data part's length gives:
 * strip the 6-character checksum and the 1-character witness version, and
 * every remaining character carries 5 bits.
 */
function mpmaCapable(address) {
  const sep = address.lastIndexOf("1");
  const looksBech32 = /^(bc|tb)1/i.test(address);
  if (!looksBech32) return true; // base58 P2PKH/P2SH pack to 21 bytes
  const data = address.slice(sep + 1);
  const programChars = data.length - 6 - 1; // checksum, witness version
  const programBytes = Math.floor((programChars * 5) / 8);
  return 1 + programBytes <= 22;
}

const mints = query(SQL);
if (mints.length < cutoff) {
  console.error(
    `Only ${mints.length} eligible mints exist; asked for ${cutoff}. ` +
      `Re-run when the programme reaches ${cutoff}.`,
  );
  process.exit(2);
}

const byAddress = new Map();
for (const m of mints) {
  const row = byAddress.get(m.source) ?? { address: m.source, mint_count: 0 };
  row.mint_count += 1;
  byAddress.set(m.source, row);
}

// Sorted by size then address: a stable order makes two runs byte-identical,
// which is what lets the manifest hash mean anything.
const payouts = [...byAddress.values()]
  .map((r) => ({ ...r, quantity: (BigInt(r.mint_count) * REWARD_PER_MINT_RAW).toString() }))
  .sort((a, b) => b.mint_count - a.mint_count || a.address.localeCompare(b.address));

const mpma = payouts.filter((p) => mpmaCapable(p.address));
const manual = payouts.filter((p) => !mpmaCapable(p.address));

/** Raw to whole units. Every payout is a whole number of MINTS by
 *  construction -- REWARD_PER_MINT_RAW is exactly 100 * 1e8 -- so this never
 *  needs a decimal point, and BigInt division cannot drift the way dividing
 *  a float by 1e8 would at these magnitudes. */
const display = (raw) => (BigInt(raw) / 100_000_000n).toString();

const csv = (rows) =>
  [
    "Address,Asset,Quantity",
    ...rows.map((r) => `${r.address},${ASSET},${display(r.quantity)}`),
  ].join("\n") + "\n";

const last = mints[mints.length - 1];
const total = payouts.reduce((sum, p) => sum + BigInt(p.quantity), 0n);

const manifest = {
  asset: ASSET,
  reward_per_mint: REWARD_PER_MINT_RAW.toString(),
  first_mint_number: 1,
  cutoff_mint_number: cutoff,
  cutoff_block: last.block_index,
  cutoff_tx_index: last.tx_index,
  cutoff_tx_hash: last.tx_hash,
  eligible_mints: mints.length,
  recipient_count: payouts.length,
  total_quantity: total.toString(),
  mpma_recipients: mpma.length,
  manual_recipients: manual.length,
  // Every mint that earns a share, in order. This is the evidence behind the
  // batch and what reward_batch_mints is populated from.
  mints: mints.map((m) => ({
    tx_hash: m.tx_hash,
    source: m.source,
    launch_tx: m.launch_tx,
    block_index: m.block_index,
    tx_index: m.tx_index,
  })),
  payouts,
};

// Hashed over the canonical payload only, with the hash field absent — so the
// digest can be recomputed from the file it is stored in.
manifest.manifest_sha256 = createHash("sha256")
  .update(JSON.stringify({ ...manifest, manifest_sha256: undefined }))
  .digest("hex");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "mpma.csv"), csv(mpma));
writeFileSync(join(outDir, "manual.csv"), csv(manual));
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const whole = (raw) => (Number(BigInt(raw) / 100_000_000n)).toLocaleString("en-US");
console.log(`reward batch through mint #${cutoff}`);
console.log(`  cutoff tx        ${last.tx_hash} (block ${last.block_index})`);
console.log(`  recipients       ${payouts.length}`);
console.log(`  total            ${whole(total)} ${ASSET}`);
console.log(`  mpma.csv         ${mpma.length} addresses, ${whole(
  mpma.reduce((s, p) => s + BigInt(p.quantity), 0n),
)} ${ASSET}`);
console.log(`  manual.csv       ${manual.length} addresses, ${whole(
  manual.reduce((s, p) => s + BigInt(p.quantity), 0n),
)} ${ASSET}`);
console.log(`  manifest_sha256  ${manifest.manifest_sha256}`);
console.log(`  written to       ${outDir}`);
