// Drafts the translations a locale is missing, with Claude, using the
// glossary. Run after i18n-extract.mjs; commit the result; a native reviewer
// edits the flat file where the English key sits beside every entry.
//
//   node scripts/i18n-draft.mjs ja          # fill what ja.json lacks
//   node scripts/i18n-draft.mjs ja --stale  # also re-draft entries the
//                                           # extractor no longer finds (drop them)
//
// Keys the model drafts are listed in <locale>.status.json under "machine",
// and a reviewer removes a key from that list when they have checked it. The
// footer tells readers of a locale that is still mostly machine-drafted.
//
// Credentials: ANTHROPIC_API_KEY, or an `ant auth login` profile.
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = new URL("../src/locales", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const [locale, ...flags] = process.argv.slice(2);
if (!locale || !/^[a-z]{2}(-[a-z]+)?$/.test(locale)) {
  console.error("usage: node scripts/i18n-draft.mjs <locale> [--stale]");
  process.exit(2);
}

const LANGUAGE = {
  ja: "Japanese",
  zh: "Simplified Chinese (mainland)",
  "zh-tw": "Traditional Chinese (Taiwan)",
  "zh-hk": "Traditional Chinese (Hong Kong)",
  es: "Spanish",
  fr: "French",
  ru: "Russian",
  uk: "Ukrainian",
  pt: "Brazilian Portuguese",
  de: "German",
  it: "Italian",
  ko: "Korean",
  tr: "Turkish",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese",
  he: "Hebrew",
}[locale];
if (!LANGUAGE) {
  console.error(`no language name for locale '${locale}' — add it to LANGUAGE in this script`);
  process.exit(2);
}

const read = (name, fallback) => {
  const p = join(LOCALES_DIR, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
};
const sourceMap = read("_source.json", null);
const source = sourceMap && !Array.isArray(sourceMap) ? Object.keys(sourceMap) : sourceMap;
const notes = read("notes.json", {});
if (!source) {
  console.error("run scripts/i18n-extract.mjs first");
  process.exit(2);
}
const messages = read(`${locale}.json`, {});
const status = read(`${locale}.status.json`, { machine: [] });
const glossary = read("glossary.json", { terms: {} });

if (flags.includes("--stale")) {
  for (const key of Object.keys(messages)) if (!source.includes(key)) delete messages[key];
  status.machine = status.machine.filter((k) => k in messages);
}
const missing = source.filter((k) => !(k in messages));
console.log(`${locale}: ${missing.length} strings to draft`);
if (missing.length === 0) process.exit(0);

const terms = Object.entries(glossary.terms)
  .filter(([, t]) => t[locale])
  .map(([en, t]) => `- "${en}" → "${t[locale]}"${t.note ? ` (${t.note})` : ""}`)
  .join("\n");

const SYSTEM = `You translate the user interface of xcp.fun, a launchpad for memecoin token launches on Counterparty (a protocol on Bitcoin), from English into ${LANGUAGE}.

Audience: crypto traders who live on exchanges and DEX screeners. They read ${LANGUAGE}, but they already use the industry's Latin abbreviations and tickers every day.

Rules:
- Each item has a key that IS the English source text. Translate the text; return it under the same key, exactly.
- Keep every {placeholder} exactly as written, including its braces and name. Never translate or reorder placeholder names.
- Keep tickers, units and abbreviations in Latin script exactly as in the source: XCP, BTC, USD, %, K, M, B, 24h, 7d, 30d, ATH, LP, AMM, sat/vB, block numbers. Keep asset names and addresses untouched.
- Each item may carry "where" (the screen or component it appears in) and "meaning" (what it refers to). Use both to choose the right sense and register; do not translate them.
- A key may end in "@@" followed by a context word (for example "All@@window"). The context is not part of the text: translate only the part before "@@", using the context to choose the sense.
- UI copy is short. Match the register and length of the source: a two-word button stays a two-word button. Do not add explanations.
- Use the glossary below for the site's own vocabulary, consistently.
- Proper nouns stay: xcp.fun, XCP.FUN, Counterparty, XCP-69, Bitcoin, Telegram.
- Sentence-level copy should read as natively written ${LANGUAGE}, not as translated English.

Glossary:
${terms || "(none)"}`;

const client = new Anthropic();
const BATCH = 40;
const drafted = {};

for (let i = 0; i < missing.length; i += BATCH) {
  const batch = missing.slice(i, i + BATCH);
  // Where a string appears, and what it means when the English alone could
  // be read two ways — the same notes the human reviewer sees.
  const items = batch.map((key) => ({
    key,
    where: (sourceMap?.[key] ?? []).map((f) => f.replace(/^app\/\[lang\]\//, "").replace(/_components\//, "").replace(/\.tsx?$/, "")).join(", "),
    meaning: notes[key] ?? notes[key.split("@@")[0]] ?? undefined,
  }));
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Translate each item. Return JSON: {"translations": [{"key": "...", "text": "..."}]} with one entry per item, keys unchanged.\n\n${JSON.stringify(items, null, 2)}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            translations: {
              type: "array",
              items: {
                type: "object",
                properties: { key: { type: "string" }, text: { type: "string" } },
                required: ["key", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["translations"],
          additionalProperties: false,
        },
      },
    },
  });
  if (response.stop_reason === "refusal") {
    console.error("refused:", response.stop_details?.explanation);
    process.exit(1);
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text);
  for (const { key, text: translated } of parsed.translations) {
    if (!batch.includes(key)) continue;
    const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (placeholders(key.split("@@")[0]) !== placeholders(translated)) {
      console.warn(`placeholder mismatch, skipped: ${key} → ${translated}`);
      continue;
    }
    drafted[key] = translated;
  }
  console.log(`  ${Math.min(i + BATCH, missing.length)}/${missing.length}`);
}

const merged = Object.fromEntries(
  Object.entries({ ...messages, ...drafted }).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(join(LOCALES_DIR, `${locale}.json`), JSON.stringify(merged, null, 2) + "\n");
status.machine = [...new Set([...status.machine, ...Object.keys(drafted)])].sort();
writeFileSync(join(LOCALES_DIR, `${locale}.status.json`), JSON.stringify(status, null, 2) + "\n");
console.log(`${locale}: drafted ${Object.keys(drafted).length}, ${Object.keys(merged).length} total`);
