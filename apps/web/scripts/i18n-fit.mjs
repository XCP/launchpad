// Which translated labels are too wide for the box they sit in.
//
//   node scripts/i18n-fit.mjs            # over-budget labels, per locale
//   node scripts/i18n-fit.mjs --all      # don't truncate the lists
//   node scripts/i18n-fit.mjs --check    # exit 1 if anything is over budget
//
// Layout breaks in a translated UI for one reason: a label got wider than
// the box it was designed for. Eyeballing eleven locales at three widths is
// not a process, so this measures instead.
//
// Two things make the measurement worth trusting.
//
// Width is estimated in ems, not counted in characters. A character is not
// a unit of width: "ミ" is twice as wide as "i", and CJK says the same thing
// in a third of the characters, so a character count would call Japanese
// short and German long when the pixels say the opposite.
//
// The budget is absolute, not a ratio against English. A ratio flags "All"
// → "全期間" (2.5×) and misses "Preguntas frecuentes", which is the one that
// actually breaks the header. What matters is whether the result fits, and
// how much room there is depends on the box — which `_source.json` knows,
// because it records the file each key came from.
//
// Only labels are measured. Prose wraps, so its width is not a defect; the
// one thing that can still break a paragraph is a single unbreakable word
// wider than its column, and that is checked separately.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = new URL("../src/locales", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (name) => JSON.parse(readFileSync(join(LOCALES_DIR, name), "utf8"));
const source = read("_source.json");
const args = process.argv.slice(2);
const showAll = args.includes("--all");
const check = args.includes("--check");

/** Advance width in ems, by script: full-width for CJK, per-glyph for Latin.
 *  Approximate on purpose — it decides "does this fit", not typesetting. */
function ems(text) {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const wide =
      c >= 0x1100 &&
      (c <= 0x115f ||
        (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6));
    if (wide) w += 1;
    else if (ch === " ") w += 0.26;
    else if (/[ilj.,:;'!|]/.test(ch)) w += 0.28;
    else if (/[mwMW]/.test(ch)) w += 0.85;
    else if (/[A-ZА-ЯЁ]/.test(ch)) w += 0.66;
    else w += 0.52;
  }
  return w;
}

/** Widest run that cannot be broken across lines. A row goes to two lines
 *  because of this, not because of the total.
 *
 *  CJK breaks between any two characters, so every ideograph is a break
 *  opportunity and a Japanese paragraph has no long "word" in it at all.
 *  Without that rule this flags every Chinese sentence on the site and
 *  finds none of the labels that actually overflow. */
const BREAK = /[\s·—/(),、。：；！？「」（）]+/;
const CJK = /[\u2e80-\ua4cf\uf900-\ufaff\uff00-\uff60\uac00-\ud7a3]/;
function longestWord(text) {
  let widest = 0;
  for (const chunk of text.split(BREAK)) {
    if (!chunk) continue;
    // A chunk containing CJK can wrap inside itself; the widest unbreakable
    // piece is the longest run of non-CJK within it.
    for (const run of chunk.split(CJK)) widest = Math.max(widest, ems(run));
  }
  return widest;
}

/**
 * How wide the string's own box is, in ems, from where the string is used.
 * These are measured from the rendered site at its tightest supported width,
 * not guessed: the header row at lg, a card's stat column at 4-up, a table
 * header before it starts eliding.
 */
const TIERS = [
  // The header row: one line, no wrapping, and every chip competes with
  // the nav for the same capped width.
  { name: "chip/nav", max: 9, test: (f) => /components\/(site-header|rewards-chip|mempool-chip|telegram-chip|language-switch)/.test(f) },
  // A launch card at four-up: each stat label gets a quarter of the row.
  { name: "card label", max: 11, test: (f) => /_components\/(launch-sections|market-pulse|launch-search|home-toolbar)/.test(f) || /\[asset\]\/_components\/(launch-stats|launch-chrome|address-badges|scheduled-pulse)/.test(f) },
  // Table headers and stat captions, before they start eliding.
  { name: "table/stat", max: 14, test: (f) => /(stats|rewards|profile|research|graveyard)\/_components/.test(f) || /_components\/(price-chart|pressure-panel|activity-tabs)/.test(f) },
];
const PROSE = { name: "prose", max: Infinity };
const COLUMN_EMS = 30; // narrowest column prose wraps in, for the word check

/**
 * Strings that never occupy a box: accessible names (`aria-label`,
 * `title`) and input placeholders, which are read aloud or sit inside a
 * field that sizes itself. They are found by scanning the source rather
 * than listed here, so the exemption cannot drift from the code.
 */
const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}
const INVISIBLE = new Set();
{
  const attr = /(?:aria-label|title|placeholder|aria-valuetext)=\{\s*t\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(attr)) INVISIBLE.add(m[1].replace(/\\"/g, '"'));
  }
}

function tierFor(key) {
  const files = source[key] ?? [];
  for (const tier of TIERS) if (files.some((f) => tier.test(f))) return tier;
  return PROSE;
}

/** A label is short, unpunctuated English — the kind of string that sits in
 *  a box rather than flowing. Sentences are prose however tight the tier. */
function isLabel(text) {
  if (text.length > 26) return false;
  if (/[.!?]$/.test(text)) return false;
  return text.split(/\s+/).length <= 4;
}

const keys = Object.keys(source);
const rows = [];
for (const name of readdirSync(LOCALES_DIR)) {
  const m = /^([a-z]{2}(?:-[a-z]{2})?)\.json$/.exec(name);
  if (!m) continue;
  const locale = m[1];
  const messages = read(name);
  for (const key of keys) {
    const translated = messages[key];
    if (!translated) continue;
    const [text] = key.split("@@");
    const tier = tierFor(key);
    const width = ems(translated);
    if (INVISIBLE.has(text)) continue;
    if (isLabel(text) && width > tier.max) {
      rows.push({ locale, key, text, translated, tier: tier.name, width, budget: tier.max, why: "wide label" });
      continue;
    }
    const word = longestWord(translated);
    if (word > COLUMN_EMS && word > longestWord(text) * 1.1) {
      rows.push({ locale, key, text, translated, tier: tier.name, width: word, budget: COLUMN_EMS, why: "unbreakable" });
    }
  }
}

rows.sort((a, b) => b.width - b.budget - (a.width - a.budget));
const byLocale = new Map();
for (const r of rows) byLocale.set(r.locale, [...(byLocale.get(r.locale) ?? []), r]);

console.log(`fit: ${rows.length} over budget in ${byLocale.size} locales (labels wider than their box, or unbreakable runs wider than a column)\n`);
for (const [locale, list] of [...byLocale].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${locale} — ${list.length}`);
  for (const r of showAll ? list : list.slice(0, 10)) {
    const over = `${r.width.toFixed(1)}/${r.budget}em`;
    console.log(`  ${over.padEnd(12)} ${r.tier.padEnd(11)} ${JSON.stringify(r.text).slice(0, 30).padEnd(32)} → ${r.translated.slice(0, 44)}`);
  }
  if (!showAll && list.length > 10) console.log(`  … ${list.length - 10} more (--all)`);
  console.log();
}

if (check && rows.length) process.exit(1);
