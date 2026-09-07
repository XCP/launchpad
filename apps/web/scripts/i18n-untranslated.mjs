// English that reaches the screen without going through `t()`.
//
//   node scripts/i18n-untranslated.mjs           # findings, grouped by file
//   node scripts/i18n-untranslated.mjs --check   # exit 1 if any are found
//
// `i18n-extract.mjs` answers "is every string we translate translated in
// every locale". It cannot answer "is every string on screen one we
// translate", because a string nobody wrapped is invisible to it: the launch
// page's Swap | Limit | Liquidity tabs printed their own mode ids for months
// and every locale reported 100% complete the whole time.
//
// So this reads the source the way a browser would, and reports text that
// will render as-is:
//
//   1. JSX text nodes with words in them.
//   2. Attributes a screen reader or tooltip speaks — aria-label, title,
//      placeholder, alt — given a bare string.
//   3. A mapped value printed as its own label: `["swap", "limit"].map((m) =>
//      <Tab>{m}</Tab>)`. This is the one that got through, and it is
//      invisible to every check that looks for string literals, because the
//      literal is in the data rather than the markup.
//
// False positives are the price of catching the third kind. Anything the
// site deliberately shows in Latin — a ticker, a brand, a unit — can be
// exempted below, and the list is short on purpose: if it grows, that is
// usually the site accreting English rather than the check being wrong.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const check = process.argv.includes("--check");

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.tsx$/.test(entry.name)) yield full;
  }
}

/** Words the site shows untranslated on purpose: tickers, brands, units,
 *  protocol names, and the handful of Latin abbreviations every locale
 *  keeps. Matched whole-string, case-sensitively. */
const KEEP = new Set([
  "XCP", "BTC", "LP", "AMM", "DEX", "API", "PSBT", "XCP-69", "MINTS", "USD", "EUR",
  "Counterparty", "Bitcoin", "Telegram", "xcp.fun", "XCP.FUN", "FAQ", "Docs", "RIP", "LIVE",
  "sats", "sat/vB", "vbyte", "tx", "TX", "PnL", "ATH", "Taproot", "JSON", "curl", "ECB",
  "English", "Telegram ↗",
  "K", "M", "B", "%", "·", "—", "↗", "→", "×", "✓", "…", "24h", "30d", "1h", "1d", "1w",
]);

/**
 * Whether a run of text is prose a reader would notice, rather than code
 * that happens to sit between two angle brackets. The docs page renders
 * field names and JSON in <code>, and a rich() node map like
 * `{ is: <code>is</code> }` looks exactly like a text node to a regex.
 */
function isProse(text) {
  const t = text.trim();
  if (t.length < 3) return false;
  if (KEEP.has(t)) return false;
  if (/^[,:.;)}\]]/.test(t)) return false; // a fragment of an expression
  if (/[_{}]/.test(t)) return false; // snake_case identifiers, object syntax
  // TypeScript generics look exactly like tags: `useState<Foo | null>(null)`
  // puts real code between two angle brackets.
  if (/[=;]/.test(t)) return false;
  if (t.startsWith("(")) return false;
  if (/\buseState\b|=>|\] = /.test(t)) return false;
  if (/[=;]|]s|useState|=>/.test(t)) return false; // a TS generic read as a tag

  if (/^[A-Z0-9_.:/-]+$/.test(t)) return false; // tickers, paths, constants
  if (/^https?:/.test(t) || /^\/v\d/.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if (!/[A-Za-z]{3}/.test(t)) return false;
  // Prose has a space, or is a single capitalised word (a button, a header).
  return /\s/.test(t) ? /[a-z]{3}/.test(t) : /^[A-Z][a-z]{2}/.test(t);
}

/** Tags whose contents are deliberately verbatim. */
const VERBATIM = /^(code|pre|kbd|samp|script|style|svg|path|circle|rect|line|polygon)$/;

const findings = [];
for (const file of files(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, "/");
  if (rel.startsWith("lib/i18n/")) continue;
  // Open Graph cards are images for social previews and stay in English:
  // a shared link is read by whoever it reaches, not by one locale.
  if (/opengraph-image|twitter-image|icon\.tsx$/.test(rel)) continue;
  const raw = readFileSync(file, "utf8");
  // Strip comments so their prose is not mistaken for markup.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // 1. JSX text nodes, with the tag they sit in so verbatim ones can go.
  for (const m of src.matchAll(/<([A-Za-z][\w.]*)[^>]*>\s*([^<>{}\s][^<>{}]*)</g)) {
    const [, tag, text] = m;
    if (VERBATIM.test(tag)) continue;
    if (!isProse(text)) continue;
    findings.push({ rel, kind: "text", text: text.trim().slice(0, 60), at: src.slice(0, m.index).split("\n").length });
  }

  // 2. Spoken attributes given a bare string rather than a call.
  for (const m of src.matchAll(/\b(aria-label|title|placeholder|alt)=("([^"]{2,})")/g)) {
    if (!isProse(m[3])) continue;
    findings.push({ rel, kind: m[1], text: m[3].slice(0, 60), at: src.slice(0, m.index).split("\n").length });
  }

  // 3. A mapped value used as its own label.
  // Only an inline array of string literals: `chips.map((c) => <span>{c}</span>)`
  // renders elements, not text, and is not a missing translation.
  for (const m of src.matchAll(/\[\s*"[^\]]*\]\s*(?:as const\s*)?\)?\.map\(\(\s*(\w+)[^)]*\)\s*=>\s*\(?([\s\S]{0,400}?)\)?\s*\)\s*[,}\n]/g)) {
    const [, name, body] = m;
    if (!new RegExp(`>\\s*\\{${name}\\}\\s*<`).test(body)) continue;
    findings.push({ rel, kind: "mapped label", text: `{${name}} printed as its own label`, at: src.slice(0, m.index).split("\n").length });
  }
}

const byFile = new Map();
for (const f of findings) byFile.set(f.rel, [...(byFile.get(f.rel) ?? []), f]);

console.log(`untranslated: ${findings.length} in ${byFile.size} files\n`);
for (const [rel, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${rel}`);
  for (const f of list) console.log(`  ${String(f.at).padStart(4)}  ${f.kind.padEnd(12)} ${JSON.stringify(f.text)}`);
  console.log();
}

if (check && findings.length) process.exit(1);
