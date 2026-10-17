import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

// Exercise the real client across separate workerd invocations. Node promises
// alone do not reproduce Workers cancelling timers and unfinished work when
// a request ends, while keeping module-level semaphore state for later runs.
const bundled = buildSync({
  stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: `
      import { fetchNodeStatus } from './apps/api/src/integrations/counterparty.ts';
      const realNow = Date.now;
      let offset = 0;
      Date.now = () => realNow() + offset;
      const realTimeout = AbortSignal.timeout;
      AbortSignal.timeout = () => realTimeout(100);
      let hanging = false;
      let started = 0;
      let completed = 0;
      globalThis.fetch = async () => {
        started++;
        if (hanging) await new Promise(resolve => setTimeout(resolve, 60_000));
        return Response.json({ result: { counterparty_height: 123, version: '11.5.0' } });
      };
      export default {
        async fetch(req) {
          if (new URL(req.url).pathname === '/abandon') {
            hanging = true;
            for (let i = 0; i < 2; i++) {
              fetchNodeStatus().finally(() => completed++).catch(() => {});
            }
            await new Promise(resolve => setTimeout(resolve, 10));
            return Response.json({ started, completed });
          }
          hanging = false;
          // Advance past the read deadline without waiting fifteen seconds.
          offset = 16_000;
          try {
            return Response.json({ node: await fetchNodeStatus(), started, completed });
          } catch (error) {
            return Response.json({ error: error.name, started, completed }, { status: 503 });
          }
        }
      };
    `,
  },
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
});
const options = {
  modules: true, script: bundled.outputFiles[0].text,
  compatibilityDate: "2025-01-01", compatibilityFlags: ["nodejs_compat"],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
beforeAll(async () => { await mf.ready; });
afterAll(async () => { await mf.dispose(); });

describe("Counterparty reads after a cancelled Worker invocation", () => {
  it("can reach the node after an earlier invocation abandons both read slots", async () => {
    const abandoned = await mf.dispatchFetch("https://test/abandon");
    expect(await abandoned.json()).toEqual({ started: 2, completed: 0 });
    const recovered = await mf.dispatchFetch("https://test/read");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      node: { height: 123, version: "11.5.0" }, started: 3, completed: 0,
    });
  });
});
