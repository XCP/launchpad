import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

/**
 * Regtest drives: real transactions against the Docker regtest pair
 * (bitcoin-core + counterparty-core, see marketplace/integration). Not part
 * of `npm test`; run with `npm run test:regtest` when the containers are up.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/regtest/**/*.regtest.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
