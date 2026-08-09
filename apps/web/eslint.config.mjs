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
    // Copied verbatim from the exchange repo's SDK; kept drop-in compatible
    // (see CLAUDE.md), so its `any`s are upstream's to fix.
    files: ["src/lib/wallet/sdk/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
