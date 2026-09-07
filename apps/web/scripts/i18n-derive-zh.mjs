// node scripts/i18n-derive-zh.mjs
// Derive zh-tw and zh-hk from the Simplified draft with OpenCC's regional
// phrase tables, then apply the glossary's own renderings where OpenCC
// disagrees, plus a few known OpenCC quirks. Writes both locale files and
// their status lists. Reviewed regional wording is kept: a reviewer removes
// its key from status.machine, as in the other translation tools.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as OpenCC from "opencc-js";
// eslint-disable-next-line no-restricted-imports -- Node scripts cannot resolve the app's @/ alias.
import { mergeDerivedMessages } from "./i18n-catalog.mjs";

const read = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;

const zh = JSON.parse(readFileSync("src/locales/zh.json", "utf8"));
const glossary = JSON.parse(readFileSync("src/locales/glossary.json", "utf8")).terms;

// OpenCC artefacts (both variants) and regional phrase fixes. OpenCC "hk"
// converts characters only, so mainland tech idioms have to be mapped here;
// "twp" over-reaches in places (引數, 視窗, 臺). Longer phrases first so a
// phrase wins over a word inside it; each pair was checked against the
// converted output for collateral matches (QA pass 2026-09-07).
const BOTH = [["銷燬", "銷毀"], ["文檔", "文件"], ["上鍊", "上鏈"], ["髮送", "發送"], ["摺合", "折合"], ["標籤頁", "分頁"], ["桌面端", "桌面版"], ["拖拽", "拖曳"]];
const QUIRKS = {
  "zh-tw": [
    ...BOTH,
    ["連線錢包", "連接錢包"], ["連線", "連接"],
    ["擴充套件", "擴充功能"], ["視窗期", "窗口期"], ["視窗結束", "窗口結束"], ["彈窗", "彈出視窗"], ["看板", "儀表板"],
    ["引數", "參數"], ["計劃", "計畫"], ["賬", "帳"], ["臺", "台"],
    // "via / through" is 透過 in Taiwan; 通過 stays where it means "passes".
    ["通過 {", "透過 {"], ["通過錢包簽名", "透過錢包簽名"], ["通過 XCP-69", "透過 XCP-69"], ["通過訂單簿", "透過訂單簿"],
    ["通過流動性池", "透過流動性池"], ["通過 Counterparty", "透過 Counterparty"], ["通過瀏覽器", "透過瀏覽器"],
  ],
  "zh-hk": [
    ...BOTH,
    ["擴展", "擴充功能"], ["默認", "預設"], ["鏈接", "連結"], ["設置", "設定"], ["信息", "資訊"], ["支持", "支援"],
    ["界面", "介面"], ["激活", "啟用"], ["緩存", "快取"], ["菜單", "選單"], ["粘貼", "貼上"], ["字段", "欄位"], ["交互", "互動"],
  ],
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
  const messagesPath = `src/locales/${variant}.json`;
  const statusPath = `src/locales/${variant}.status.json`;
  const merged = mergeDerivedMessages(out, read(messagesPath, {}), read(statusPath, { machine: [] }));
  writeFileSync(messagesPath, JSON.stringify(merged.messages, null, 2) + "\n");
  writeFileSync(statusPath, JSON.stringify(merged.status, null, 2) + "\n");
  console.log(variant, Object.keys(merged.messages).length, "entries; glossary overrides:", overrides.map(([a, b]) => `${a}→${b}`).join(" "));
}
