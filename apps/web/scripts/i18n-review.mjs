// A review sheet for a native speaker: every string in a locale with its
// English, where it appears, what it means, and whether a person has
// checked it yet. Markdown, so it can be pasted into a doc or a chat.
//
//   node scripts/i18n-review.mjs ja > review-ja.md
//   node scripts/i18n-review.mjs ja --machine   # only the unreviewed ones
//
// A reviewer edits src/locales/<locale>.json directly (the English key sits
// beside every entry) and deletes what they have checked from the "machine"
// list in <locale>.status.json. This sheet is how they see the whole thing
// at once.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = new URL("../src/locales", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const [locale, ...flags] = process.argv.slice(2);
if (!locale) {
  console.error("usage: node scripts/i18n-review.mjs <locale> [--machine]");
  process.exit(2);
}
const read = (name, fallback) => {
  const p = join(LOCALES_DIR, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
};
const source = read("_source.json", {});
const messages = read(`${locale}.json`, {});
const status = read(`${locale}.status.json`, { machine: [] });
const notes = read("notes.json", {});
const machine = new Set(status.machine);
const onlyMachine = flags.includes("--machine");

const where = (key) => {
  const files = Array.isArray(source) ? [] : (source[key] ?? []);
  return files.map((f) => f.replace(/^app\/\[lang\]\//, "").replace(/_components\//, "").replace(/\.tsx?$/, "")).join(", ");
};
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

const keys = Object.keys(messages).filter((k) => !onlyMachine || machine.has(k));
console.log(`# ${locale}: ${keys.length} strings${onlyMachine ? " awaiting review" : ""}\n`);
console.log("| | English | " + locale + " | Where | Meaning |");
console.log("|---|---|---|---|---|");
for (const key of keys) {
  const [text, context] = key.split("@@");
  const meaning = [notes[key] ?? notes[text], context ? `(context: ${context})` : ""].filter(Boolean).join(" ");
  console.log(`| ${machine.has(key) ? "🤖" : "✅"} | ${esc(text)} | ${esc(messages[key])} | ${esc(where(key))} | ${esc(meaning)} |`);
}
