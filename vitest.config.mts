import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Unit tests for the pure layers only — the numeric primitives, the XCP-69
 * predicate, the candle fold, and the small pure helpers the app leans on.
 *
 * Deliberately no jsdom and no component rendering. What is worth testing
 * here is the code where being wrong is SILENT: a predicate that admits a
 * non-conforming launch, or a serializer that puts the wrong digits into a
 * transaction, produces something that looks entirely normal and is wrong
 * permanently. A broken layout announces itself; these do not.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/web/tsconfig.json's paths and the @launchpad/xcp69
      // subpath exports, so tests import modules exactly as the app does
      // rather than through relative paths that could drift.
      "@/": `${here("./apps/web/src")}/`,
      // apps/api's own subpath imports, so the worker's pure layers are
      // testable on the same terms as the web app's.
      "#api/": `${here("./apps/api/src")}/`,
      "@launchpad/xcp69/xcp69": here("./packages/xcp69/src/xcp69.ts"),
      "@launchpad/xcp69/description": here("./packages/xcp69/src/description.ts"),
      "@launchpad/xcp69/numeric": here("./packages/xcp69/src/numeric.ts"),
      "@launchpad/xcp69/candles": here("./packages/xcp69/src/candles.ts"),
      "@launchpad/xcp69/mempool": here("./packages/xcp69/src/mempool.ts"),
      "@launchpad/xcp69/dispenser-price": here(
        "./packages/xcp69/src/dispenser-price.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
