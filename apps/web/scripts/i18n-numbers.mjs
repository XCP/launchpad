// Numbers formatted in a language the page is not in.
//
//   node scripts/i18n-numbers.mjs           # findings, grouped by file
//   node scripts/i18n-numbers.mjs --check   # exit 1 if any are found
//
// The sibling checks answer "is every string translated" and "is every string
// on screen one we translate". Neither sees a number: `43,892.4 XCP` is not a
// string anybody wrapped, and it sat on the French stats page for as long as
// the page existed, one hard-coded "en-US" inside a helper.
//
// Two shapes are wrong, for different reasons:
//
//   1. A pinned English locale — toLocaleString("en-US"), Intl.NumberFormat
//      ("en-US"). The page renders in French and the figure does not.
//   2. No locale at all — `height.toLocaleString()`. This one is worse than
//      it looks: on the server it formats in the worker's locale and in the
//      browser it formats in the visitor's, so the two disagree and React
//      reports a hydration mismatch on a page that looked fine locally.
//
// The fix for both is the bound formatters: `useNumbers()` in a client
// component, `await getNumbers()` on the server, or a `num: Numbers`
// parameter for a helper at module scope.
//
// A site that genuinely must pin a locale — a machine format, a date the
// design wants in one language — says so with `// i18n-number-ok` on the line
// or the line above.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const check = process.argv.includes("--check");

/** Where the locale-aware formatters are defined; they hold the defaults. */
const DEFINES = new Set(["lib\\format.ts", "lib/format.ts"]);

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

const PINNED = /(?:toLocaleString|Intl\.(?:NumberFormat|DateTimeFormat))\(\s*["'](en|en-US)["']/g;
const AMBIENT = /\.toLocaleString\(\s*\)/g;

const findings = [];
for (const file of files(SRC)) {
  const rel = relative(SRC, file);
  if (DEFINES.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  const record = (index, kind, text) => {
    const at = src.slice(0, index).split("\n").length;
    const here = lines[at - 1] ?? "";
    const above = lines[at - 2] ?? "";
    if (here.includes("i18n-number-ok") || above.includes("i18n-number-ok")) return;
    findings.push({ rel, at, kind, text: text.trim().slice(0, 70) });
  };
  for (const m of src.matchAll(PINNED)) record(m.index, "pinned to English", lines[src.slice(0, m.index).split("\n").length - 1]);
  for (const m of src.matchAll(AMBIENT)) record(m.index, "no locale at all", lines[src.slice(0, m.index).split("\n").length - 1]);
}

const byFile = new Map();
for (const f of findings) byFile.set(f.rel, [...(byFile.get(f.rel) ?? []), f]);

console.log(`unlocalized numbers: ${findings.length} in ${byFile.size} files\n`);
for (const [rel, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${rel}`);
  for (const f of list) console.log(`  ${String(f.at).padStart(4)}  ${f.kind.padEnd(18)} ${JSON.stringify(f.text)}`);
  console.log();
}

if (check && findings.length) process.exit(1);
