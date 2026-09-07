import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// next lint was removed in Next 16; this is the ESLint CLI config it used to
// bootstrap (see node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md).
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".open-next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    // Every import addresses a module the same way, so a file's imports read
    // the same wherever the file happens to sit — and moving a file never
    // rewrites the imports of its neighbours. Enforced rather than agreed,
    // because a convention nobody checks is a convention that drifts.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["./*", "../*"],
              message: "Use the @/ path alias instead of a relative import.",
            },
          ],
          // Links prefetch on intent, not on sight; see LazyLink for the
          // measurement behind it. A bare next/link here reintroduces two
          // server requests per link that scrolls into view.
          paths: [
            {
              name: "next/link",
              message: "Import { LazyLink } from @/components/lazy-link instead.",
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * A number formatted in a language the page is not in.
     *
     * The site renders in eleven locales and four of them do not group in
     * commas, so a hard-coded "en-US" writes 43,892.4 on a French page that
     * says 2 327 two boxes away. A locale argument left out entirely is
     * worse: it follows the SERVER's locale during render and the VISITOR's
     * in the browser, so the two disagree and React reports a hydration
     * mismatch on a page that looked fine locally.
     *
     * Both are the same fix — the bound formatters, `useNumbers()` in a
     * client component, `await getNumbers()` on the server, or a
     * `num: Numbers` parameter for a helper at module scope.
     *
     * A lint rule rather than the script this replaces, because the script
     * only ran when somebody remembered to run it, and this is underlined in
     * the editor as the line is typed. A site that genuinely must pin a
     * locale says so with an eslint-disable comment and a reason.
     */
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/format.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toLocaleString'][arguments.length=0]",
          message:
            "toLocaleString() with no locale formats in the server's language, then in the visitor's — a hydration mismatch. Use the bound formatters: num.commas, num.fixed, num.percent.",
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString'] > Literal.arguments:first-child[value=/^en(-[A-Z]{2})?$/]",
          message:
            "This page is not always in English. Use the bound formatters (num.commas, num.fixed, num.percent) or num.intl.",
        },
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'] > Literal.arguments:first-child[value=/^en(-[A-Z]{2})?$/]",
          message:
            "This page is not always in English. Pass num.intl, or getNumbers().intl on the server.",
        },
      ],
    },
  },
  {
    // The one place next/link is meant to be imported.
    files: ["src/components/lazy-link.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Copied verbatim from the exchange repo's SDK; kept drop-in compatible
    // (see CLAUDE.md), so its `any`s are upstream's to fix, and its internal
    // relative imports are upstream's to keep.
    files: ["src/lib/wallet/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
