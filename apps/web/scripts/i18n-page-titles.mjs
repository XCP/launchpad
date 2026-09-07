// One-off: make each page's title and description translatable. The static
// PAGE_METADATA strings get a msg() marker so the extractor sees them, and
// the page's generateMetadata translates them for the locale it renders.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP = new URL("../src/app/[lang]", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!name.startsWith("_")) yield* pages(path);
    } else if (name === "page.tsx") yield path;
  }
}

for (const file of pages(APP)) {
  const raw = readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  let src = crlf ? raw.replace(/\r\n/g, "\n") : raw;
  if (!src.includes("const PAGE_METADATA")) continue;
  const before = src;

  // title: "..." and description: "..." inside the PAGE_METADATA block only.
  const start = src.indexOf("const PAGE_METADATA");
  const end = src.indexOf("\n};\n", start) + 4;
  let block = src.slice(start, end);
  block = block.replace(/^(\s*(?:title|description):\s*)"((?:[^"\\]|\\.)*)"/gm, (m, pre, text) => `${pre}msg("${text}")`);
  // Multi-line description: `description:\n    "..."`.
  block = block.replace(/^(\s*description:\n\s*)"((?:[^"\\]|\\.)*)"/gm, (m, pre, text) => `${pre}msg("${text}")`);
  src = src.slice(0, start) + block + src.slice(end);

  src = src.replace(
    /return \{ \.\.\.PAGE_METADATA, alternates: localeAlternates\(isLocale\(lang\) \? lang : "en", "([^"]+)"\) \};/,
    (m, path) =>
      `const locale = isLocale(lang) ? lang : "en";\n  const t = makeT(await getMessages(locale));\n  return {\n    ...PAGE_METADATA,\n    title: t(PAGE_METADATA.title),\n    ...(PAGE_METADATA.description ? { description: t(PAGE_METADATA.description) } : {}),\n    alternates: localeAlternates(locale, "${path}"),\n  };`,
  );
  if (src === before) { console.log("unchanged", file); continue; }
  src = src.replace(
    `import { localeAlternates } from "@/lib/i18n/seo";\n`,
    `import { localeAlternates } from "@/lib/i18n/seo";\nimport { getMessages } from "@/lib/i18n/server";\nimport { makeT, msg } from "@/lib/i18n/t";\n`,
  );
  writeFileSync(file, crlf ? src.replace(/\n/g, "\r\n") : src);
  console.log("titles translatable:", file.slice(APP.length));
}
