// Collects every `t("...")` source string in the web app into
// src/locales/_source.json, and reports what each locale is missing.
//
// English is the key, so there is nothing to name: the catalog is the set of
// English strings the components actually contain, found by scanning for the
// call. A string that stops appearing here is dead in every language at once.
//
//   node scripts/i18n-extract.mjs          # write _source.json, report gaps
//   node scripts/i18n-extract.mjs --check  # exit 1 if a locale has gaps
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LOCALES_DIR = join(ROOT, "locales");
const check = process.argv.includes("--check");

// t("text"), t('text'), t(`text`) with no ${}, optionally followed by
// `, {vars}` or `, "context"`. Multi-line calls are matched because the
// argument is the first thing after the paren.
const CALL = /\b(?:t\(|msg\(|rich\(\s*t\s*,)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)\s*(?:,\s*(?:"([^"]*)"|'([^']*)'))?/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // lib/i18n documents the call in comments; nothing there is UI text.
      if (name === "node_modules" || name === "locales" || path.endsWith("i18n")) continue;
      yield* files(path);
    } else if (/\.(tsx?|mjs)$/.test(name)) yield path;
  }
}

const found = new Map(); // key -> [files]
for (const file of files(ROOT)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(CALL)) {
    const text = (m[1] ?? m[2] ?? m[3]).replace(/\\(["'`])/g, "$1");
    const context = m[4] ?? m[5];
    if (!text.trim()) continue;
    const key = context ? `${text}@@${context}` : text;
    const list = found.get(key) ?? [];
    list.push(relative(ROOT, file).replace(/\\/g, "/"));
    found.set(key, list);
  }
}

const keys = [...found.keys()].sort((a, b) => a.localeCompare(b));
const sourcePath = join(LOCALES_DIR, "_source.json");
const previous = existsSync(sourcePath) ? Object.keys(JSON.parse(readFileSync(sourcePath, "utf8"))).length : 0;
// Key → the files it appears in. Where a string lives is context a
// translator needs: "Side" is one word as a table header and another as a
// sentence, and the draft script hands this to the model with each item.
const source = Object.fromEntries(keys.map((k) => [k, [...new Set(found.get(k))].sort()]));
writeFileSync(sourcePath, JSON.stringify(source, null, 2) + "\n");
console.log(`source: ${keys.length} strings (${keys.length - previous >= 0 ? "+" : ""}${keys.length - previous})`);

// A t(x) whose argument is not a literal is translating a string defined
// elsewhere — fine when that definition is wrapped in msg(), invisible to
// this scan when it is not. List them so a bare label array cannot hide.
const INDIRECT = /\bt\(\s*([A-Za-z_$][\w$.]*)\s*\)/g;
const indirect = [];
for (const file of files(ROOT)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(INDIRECT)) indirect.push(`${relative(ROOT, file).replace(/\\/g, "/")}: t(${m[1]})`);
}
if (indirect.length && !check) {
  console.log(`indirect: ${indirect.length} t(identifier) calls — their labels must be msg()-marked where defined:`);
  for (const line of indirect) console.log(`  ${line}`);
}

let failed = false;
for (const name of readdirSync(LOCALES_DIR)) {
  if (!/^[a-z]{2}(-[a-z]+)?.json$/.test(name)) continue;
  const messages = JSON.parse(readFileSync(join(LOCALES_DIR, name), "utf8"));
  const missing = keys.filter((k) => !(k in messages));
  const stale = Object.keys(messages).filter((k) => !found.has(k));
  console.log(`${name}: ${keys.length - missing.length}/${keys.length} translated, ${missing.length} missing, ${stale.length} stale`);
  if (missing.length && !check) for (const k of missing.slice(0, 20)) console.log(`  missing: ${k}`);
  if (stale.length && !check) for (const k of stale.slice(0, 20)) console.log(`  stale:   ${k}`);
  if (check && (missing.length || stale.length)) failed = true;
}
if (failed) process.exit(1);
