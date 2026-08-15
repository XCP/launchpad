import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

/**
 * This worker had no lint at all — apps/web has run ESLint since it was
 * written, and the same repo's other half, ~1,500 lines that own every write
 * to a billed database, was checked by `tsc` alone. Not Next's config: none of
 * its rules are about React here, and half of them would be noise.
 *
 * Deliberately the untyped recommended set rather than the type-aware one. The
 * type-aware rules need a second full program parse on every run, and `tsc
 * --noEmit` already runs immediately before this in the same `check` script —
 * so the expensive half of what they check is checked anyway, and the cheap
 * half is what ESLint is actually here for.
 */
export default defineConfig([
  globalIgnores([".wrangler/**", "migrations/**", "worker-configuration.d.ts"]),
  ...tseslint.configs.recommended,
  {
    rules: {
      // Same rule apps/web enforces, same reason: every import addresses a
      // module the same way, so a file's imports read the same wherever the
      // file sits, and moving a file never rewrites its neighbours'. This
      // worker declares `#api/*` in its package.json imports for exactly that
      // purpose, and mostly honours it already — enforced rather than agreed,
      // because a convention nobody checks is one that drifts.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["./*", "../*"],
              message: "Use the #api/ subpath import instead of a relative one.",
            },
          ],
        },
      ],
      // A caught error this worker deliberately swallows is the norm here, not
      // an oversight: a Counterparty hiccup should skip a tick, not tear down
      // the room or fail the whole sync. Those sites are commented where they
      // occur; an empty block is still worth flagging.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
]);
