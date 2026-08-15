/**
 * Numeric discipline check. Run by `npm run check`.
 *
 * Two halves. The first asserts that `src/lib/numeric.ts` still behaves at the
 * magnitudes this site actually handles — including the two defects that
 * prompted it, so a regression reads as a failing case rather than as a number
 * nobody looked at closely. The second greps the tree for the operators that
 * silently narrow a 64-bit quantity to a double, on identifiers that name
 * money.
 *
 * A script rather than a test file. That used to be because the repo had no
 * test runner; it has one now (vitest, and the predicate's own cases live
 * there). What keeps this separate is the second half: a scan of every source
 * file in two apps is a lint pass wearing a test's clothes, and it belongs in
 * `npm run check` beside tsc and eslint rather than in a suite that is
 * supposed to run in milliseconds. Node runs TypeScript directly, so it can
 * still import the real module rather than a copy that could drift from it.
 *
 * Not everything numeric is money. Block heights, tx indices, vbytes, retry
 * counts and array lengths are counts, nowhere near 2^53, and converting them
 * is exact — the NOT_MONEY list below is what keeps this check pointed at the
 * values that can actually be wrong.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
// xcp69.ts and numeric.ts moved to the shared package the API worker also
// reads from (see @launchpad/xcp69); the app's own copy is a re-export.
const XCP69_SRC = join(ROOT, "..", "..", "packages", "xcp69", "src");
// The API worker, scanned on the same terms. It was outside this check for as
// long as it has existed, which made the rule half a rule: the repo's standing
// instruction is that ALL standard math is in raw integer satoshi units, and
// apps/api reads the same quantities off the same API and writes them to D1.
// A `Number(...)` on a pool reserve is exactly as wrong there as here, and
// until now nothing said so.
const API_SRC = join(ROOT, "..", "api", "src");

const failures = [];
const check = (name, actual, expected) => {
  if (actual !== expected) {
    failures.push(`${name}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
};

const {
  approx,
  big,
  compareRawDesc,
  formatExact,
  isSafeQuantity,
  parseJsonLossless,
  parseUnitsToRaw,
  percentOf,
  quantityParam,
  ratio,
  rawEquals,
  rawToDecimalString,
  reduceByPercent,
  sumRaw,
} = await import("../src/lib/numeric.ts");

// numeric.ts imports nothing, so Node loads it directly. xcp69.ts does import
// it, through the `@/` alias Node knows nothing about — so the one constant
// needed here is restated and pinned to the source text instead. If the
// standard's hard cap ever changes, this fails rather than quietly testing a
// value the site no longer uses.
const XCP69_HARD_CAP = 10_000_000_000_000_000n;
if (
  !readFileSync(join(XCP69_SRC, "xcp69.ts"), "utf8").includes(
    "HARD_CAP: 10_000_000_000_000_000n",
  )
) {
  failures.push("XCP69_EXACT.HARD_CAP no longer matches the value asserted here");
}

/* ------------------------------------------------------------------ */
/* Behaviour, at the magnitudes that matter                            */
/* ------------------------------------------------------------------ */

// PEPECASH's real mainnet supply. The defect that started all of this: a
// display path converted the string to a number en route to the formatter and
// dropped the last two digits.
const PEPECASH_SUPPLY = "99526914711111111";
check(
  "PEPECASH supply renders every digit",
  formatExact(rawToDecimalString(PEPECASH_SUPPLY), { maximumFractionDigits: 8 }),
  "995,269,147.11111111",
);
// And the path it replaced still gets it wrong, so this case is not vacuous.
if (
  (Number(PEPECASH_SUPPLY) / 1e8).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  }) === "995,269,147.11111111"
) {
  failures.push("the double path no longer differs — this case proves nothing");
}

// TTTTTAAAAAA, a mainnet fairminter reachable at /TTTTTAAAAAA while
// SHOW_NONCONFORMING is on, reports i64 max as its hard cap.
check(
  "u64/i64-max quantities survive parsing",
  parseJsonLossless('{"hard_cap": 9223372036854775807}').hard_cap,
  "9223372036854775807",
);
check(
  "full u64 range formats exactly",
  formatExact(rawToDecimalString("18446744073709551615"), {
    maximumFractionDigits: 8,
  }),
  "184,467,440,737.09551615",
);
check(
  "safe-range integers keep their shape",
  typeof parseJsonLossless('{"q": 100000000}').q,
  "number",
);
check(
  "fractions are left alone",
  parseJsonLossless('{"usd": 1.5, "e": 1e3}').usd,
  1.5,
);
check(
  "digits inside strings are not rewritten",
  parseJsonLossless('{"memo": "99526914711111111"}').memo,
  "99526914711111111",
);

// The conformance predicate is this site's editorial policy, and XCP-69's hard
// cap is 10^16 — above the safe range, where the gap between representable
// integers is 2. A record one raw unit off parses onto the standard's value.
check(
  "a hard cap one unit off does not pass as the standard",
  rawEquals(parseJsonLossless('{"h": 10000000000000001}').h, XCP69_HARD_CAP),
  false,
);
check(
  "the standard's own hard cap still passes",
  rawEquals("10000000000000000", XCP69_HARD_CAP),
  true,
);
// The check above only means something if plain JSON.parse would have been
// fooled — which is the whole reason the boundary changed.
if (JSON.parse('{"h": 10000000000000001}').h !== 10_000_000_000_000_000) {
  failures.push("JSON.parse no longer collides here — this case proves nothing");
}

// Accumulators: a total can leave the safe range even when every row is inside it.
check(
  "sums stay exact past 2^53",
  sumRaw(["9007199254740991", 1, 1, 1]).toString(),
  "9007199254740994",
);
check("null and undefined rows count as zero", sumRaw([null, undefined, 5]), 5n);
check(
  "sorting compares digits, not a subtraction",
  compareRawDesc("10000000000000001", "10000000000000000"),
  -1,
);

// Typed amounts. Selling a whole 100M-supply XCP-69 bag is 10^16 raw.
check("a whole 100M bag reads exactly", parseUnitsToRaw("100000000"), 10_000_000_000_000_000n);
check("one raw unit", parseUnitsToRaw("0.00000001"), 1n);
check("extra decimals truncate, never round up", parseUnitsToRaw("1.999999999"), 199_999_999n);
check("empty input is not zero", parseUnitsToRaw(""), null);
check("non-numeric input is refused", parseUnitsToRaw("1e8"), null);
// The multiplication it replaces cannot represent that amount.
check(
  "the old parseFloat path is past the safe range here",
  Number.isSafeInteger(Math.round(100000000 * 1e8)),
  false,
);

// Slippage floors and preset buttons, on a balance a double cannot hold.
check("slippage floors exactly", reduceByPercent("10000000000000000", 0.5), 9_950_000_000_000_000n);
check("a tenth of a percent is representable", reduceByPercent("10000000000000000", 1.5), 9_850_000_000_000_000n);
check("Max is the whole balance", percentOf("10000000000000001", 100), 10_000_000_000_000_001n);
check("presets scale exactly", percentOf("10000000000000000", 25), 2_500_000_000_000_000n);

// Ratios are doubles on purpose, but their operands are not.
check("a ratio of two out-of-range quantities", ratio("10000000000000000", "20000000000000000"), 0.5);
check("division by zero is zero, not NaN", ratio(1, 0), 0);

// The compose gate. This is the last thing between a typed amount and a
// signature, so it refuses rather than guesses.
check("a safe integer composes", quantityParam(690_000_000_000), "690000000000");
check("a bigint composes exactly", quantityParam(10_000_000_000_000_001n), "10000000000000001");
check("a string passes through", quantityParam("18446744073709551615"), "18446744073709551615");
check("a number past 2^53 is refused", isSafeQuantity(1e16), false);
check("a number that String() would exponentiate is refused", isSafeQuantity(1e21), false);
check("a fractional quantity is refused", isSafeQuantity(1.5), false);
check("NaN is refused", isSafeQuantity(NaN), false);
// String(1e21) is "1e+21", which the compose endpoint cannot read as a quantity.
check("and String would have written exponent notation", String(1e21), "1e+21");

// A double is not trusted to name an integer it cannot represent.
check("an unsafe number is not silently converted", big(1e16), 0n);
check("its exact string is", big("10000000000000000"), 10_000_000_000_000_000n);
check("approx is the deliberate way back to a double", approx("10000000000000000"), 1e16);

/* ------------------------------------------------------------------ */
/* The conformance predicate compares digits                           */
/* ------------------------------------------------------------------ */

// isXcp69 is this site's editorial policy, and the type system will not defend
// it: `Raw === number` is a legal comparison, so reverting a clause to `===`
// type-checks cleanly and quietly reintroduces the plus-or-minus-one on the
// hard cap. The rule has to be stated somewhere, so it is stated here.
{
  const source = readFileSync(join(XCP69_SRC, "xcp69.ts"), "utf8");
  const body = /export function isXcp69\([\s\S]*?\n}/.exec(source)?.[0];
  if (!body) {
    failures.push("cannot find isXcp69 — this check has gone stale");
  } else {
    // Named explicitly, because the clauses that SHOULD use === are right
    // beside these: block heights, the status string, the confirmed flag.
    const QUANTITY_FIELD =
      /fm\.(price|quantity_by_price|hard_cap|soft_cap|max_mint_per_tx|max_mint_per_address|premint_quantity|pool_quantity|minted_asset_commission_int|earned_quantity|paid_quantity)\b/;
    const loose = body
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, ""))
      .filter((line) => /===/.test(line) && QUANTITY_FIELD.test(line));
    if (loose.length > 0) {
      failures.push(
        "isXcp69 compares a quantity with ===:\n" +
          loose.map((l) => `      ${l.trim()}`).join("\n") +
          "\n      Use rawEquals against XCP69_EXACT. The standard's hard cap is 10^16," +
          "\n      where the gap between representable integers is 2, so a record one" +
          "\n      raw unit off parses onto it and takes the XCP-69 badge.",
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Static check: raw arithmetic on money-named identifiers             */
/* ------------------------------------------------------------------ */

/** Operators that convert to a double before the arithmetic starts. */
const RAW_NUMERIC =
  /\b(Number\(|parseFloat\(|parseInt\(|Math\.(floor|round|ceil|abs|min|max|pow)\()/g;

/** Identifiers that mark a value as money rather than a count or an index. */
const MONEY =
  /quantity|amount|satoshi|sats|supply|balance|reserve|escrow|earned|paid|payout|premint|hard_cap|soft_cap|give_|get_|_remaining/i;

/**
 * A line that has already gone through the numeric layer. `approx` and `ratio`
 * exist precisely to say "a double is the right answer here, deliberately", so
 * clamping or flooring their result is the discipline working rather than a
 * breach of it — `Math.min(100, ratio(a, b) * 100)` is a percentage.
 */
const THROUGH_LAYER =
  /\b(approx|ratio|big|sumRaw|percentOf|reduceByPercent|parseUnitsToRaw|commasRaw)\(/;

/** Values that are counts, not money: converting these is exact and fine. */
const NOT_MONEY =
  /block_index|blockIndex|blockHeight|start_block|end_block|deadline_block|expire|tx_index|timeout|Date\.|\.length|index|vout|vbyte|nonce|decimals|divisor|confirmations|attempts|retries|misses|limit|offset|cursor|width|size|page/i;

/**
 * Files allowed raw arithmetic. Every entry needs a reason, because an
 * unargued exemption is how a rule like this quietly stops meaning anything.
 */
const EXEMPT = new Map([
  ["lib/numeric.ts", "defines the conversions everything else is required to use"],
  ["lib/format.ts", "renders through Intl, which takes the exact decimal string"],
  [
    "app/dispense/_lib/use-dispense-router.ts",
    "Bitcoin sat amounts and XCP dispenser units, bounded by XCP's 2.6M supply",
  ],
  [
    "lib/inscribe-launch.ts",
    "Bitcoin transaction construction: input values, vbytes and dust thresholds",
  ],
  [
    "lib/launch-cost.ts",
    "the same category as inscribe-launch: vbytes and multisig dust thresholds " +
      "for one transaction, bounded by a few thousand satoshi — derived from " +
      "core's own chunk size and DEFAULT_MULTISIG_DUST_SIZE, never from an " +
      "asset quantity",
  ],
  [
    "app/dispense/_components/bridge.tsx",
    "XCP dispenser units and Bitcoin sat amounts, bounded by XCP's 2.6M supply — " +
      "whole XCP only on the sell side, so escrow_quantity is an exact integer " +
      "and useCompose's quantityParam gate rejects it if it ever isn't",
  ],
  [
    "app/faq/_components/explainer.tsx",
    "a simulator in whole units derived from the XCP-69 constants (690 XCP, " +
      "31M tokens) — no API values, nothing composed",
  ],
  [
    "app/[asset]/_components/phase-preview.tsx",
    "the design-phase simulator: fabricates a tape from the standard's own " +
      "constants so every lifecycle state can be looked at",
  ],
]);

/** Raw money arithmetic on a line, ignoring comments. */
export function violationsIn(source) {
  let count = 0;
  // Split on either line ending: `.` does not match `\r`, so on a CRLF
  // checkout `//.*$` never reaches end-of-line and strips nothing — comments
  // would be scanned as code, and the count would differ between a Windows
  // working copy and a Linux CI one.
  for (const line of source.split(/\r?\n/)) {
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    if (!MONEY.test(code) || NOT_MONEY.test(code) || THROUGH_LAYER.test(code)) continue;
    const matches = code.match(RAW_NUMERIC);
    if (matches) count += matches.length;
  }
  return count;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Web files keep their bare path so the exemptions above read unchanged; API
// files carry an `api:` prefix, because "indexer/sync.ts" and "lib/format.ts"
// sitting in one list with no way to tell which app they belong to is how an
// exemption gets granted to the wrong file.
const key = (file) =>
  (file.startsWith(API_SRC)
    ? `api:${relative(API_SRC, file)}`
    : relative(SRC, file)
  )
    .split(sep)
    .join("/");
const files = [...sourceFiles(SRC), ...sourceFiles(API_SRC)].filter(
  (file) => !EXEMPT.has(key(file)),
);

if (files.length < 50) {
  failures.push(`only found ${files.length} source files — the scan is not reaching the tree`);
}

// The detector reads lines, so it is worth knowing it still reacts.
check("would catch a new one", violationsIn("const fee = Number(row.quantity) * 2;"), 1);
check("leaves block heights alone", violationsIn("const b = Number(tx.block_index);"), 0);
check("does not read comments as code", violationsIn("// Number(quantity) in a comment"), 0);
check("accepts the numeric layer", violationsIn("const total = approx(sumRaw(quantities));"), 0);
check(
  "accepts clamping a ratio",
  violationsIn("const pct = Math.min(100, ratio(earned, target) * 100);"),
  0,
);

const offenders = files
  .map((file) => ({ file: key(file), count: violationsIn(readFileSync(file, "utf8")) }))
  .filter((entry) => entry.count > 0);

if (offenders.length > 0) {
  failures.push(
    "raw arithmetic on money-named identifiers:\n" +
      offenders.map((o) => `      ${o.file}: ${o.count}`).join("\n") +
      "\n      Use src/lib/numeric.ts, or add an argued exemption to this script.",
  );
}

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`\nnumeric discipline: ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}

console.log(`numeric discipline: ok (${files.length} files scanned)`);
