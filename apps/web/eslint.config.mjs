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
        },
      ],
    },
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
