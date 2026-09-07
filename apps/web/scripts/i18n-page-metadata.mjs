// One-off: turn each page's static `export const metadata = {...}` into a
// `generateMetadata` that adds the page's hreflang/canonical set for the
// locale it is rendered under. The page's own title and description are kept
// as written; only the alternates are added, from the page's route path.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

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
  const m = src.match(/^export const metadata(: Metadata)? = \{\n[\s\S]*?\n\};\n/m);
  if (!m) continue;
  const routePath = "/" + relative(APP, file).replace(/\\/g, "/").replace(/\/?page\.tsx$/, "");
  if (routePath.includes("[")) { console.log(`skip (dynamic): ${routePath}`); continue; }
  const typed = Boolean(m[1]);
  const block = m[0].replace(/^export const metadata/, "const PAGE_METADATA");
  const fn = `
/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return { ...PAGE_METADATA, alternates: localeAlternates(isLocale(lang) ? lang : "en", "${routePath === "" ? "/" : routePath}") };
}
`;
  src = src.replace(m[0], block + fn);
  // Imports: the seo helper and locale guard; Metadata type if not present.
  const importLine = `import { isLocale } from "@/lib/i18n/locales";\nimport { localeAlternates } from "@/lib/i18n/seo";\n`;
  const firstImport = src.search(/^import /m);
  src = src.slice(0, firstImport) + importLine + src.slice(firstImport);
  if (!typed && !/import type \{ Metadata \} from "next"/.test(src) && !/import \{[^}]*\bMetadata\b[^}]*\} from "next"/.test(src)) {
    src = `import type { Metadata } from "next";\n` + src;
  }
  writeFileSync(file, crlf ? src.replace(/\n/g, "\r\n") : src);
  console.log(`converted ${routePath || "/"}`);
}
