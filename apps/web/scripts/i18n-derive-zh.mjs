// node scripts/i18n-derive-zh.mjs
// Derive zh-tw and zh-hk from the Simplified draft with OpenCC's regional
// phrase tables, then apply the glossary's own renderings where OpenCC
// disagrees, plus a few known OpenCC quirks. Writes both locale files and
// their status lists.
import { readFileSync, writeFileSync } from "node:fs";
import * as OpenCC from "opencc-js";

const zh = JSON.parse(readFileSync("src/locales/zh.json", "utf8"));
const glossary = JSON.parse(readFileSync("src/locales/glossary.json", "utf8")).terms;

const QUIRKS = {
  "zh-tw": [["銷燬", "銷毀"], ["連線錢包", "連接錢包"], ["連線", "連接"], ["文檔", "文件"]],
  "zh-hk": [["銷燬", "銷毀"], ["文檔", "文件"]],
};

for (const [variant, to] of [["zh-tw", "twp"], ["zh-hk", "hk"]]) {
  const convert = OpenCC.Converter({ from: "cn", to });
  // Glossary overrides: what OpenCC makes of the Simplified term vs what the
  // glossary wants for this variant. Longest first so a phrase wins over a
  // word inside it.
  const overrides = Object.values(glossary)
    .filter((t) => t.zh && t[variant] && convert(t.zh) !== t[variant])
    .map((t) => [convert(t.zh), t[variant]])
    .sort((a, b) => b[0].length - a[0].length);
  const out = {};
  for (const [key, value] of Object.entries(zh)) {
    let s = convert(value);
    for (const [from, to2] of [...QUIRKS[variant], ...overrides]) s = s.split(from).join(to2);
    out[key] = s;
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`src/locales/${variant}.json`, JSON.stringify(sorted, null, 2) + "\n");
  writeFileSync(`src/locales/${variant}.status.json`, JSON.stringify({ machine: Object.keys(sorted) }, null, 2) + "\n");
  console.log(variant, Object.keys(sorted).length, "entries; glossary overrides:", overrides.map(([a, b]) => `${a}→${b}`).join(" "));
}
