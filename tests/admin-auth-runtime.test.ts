import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
// Bundle the real API entry point, including admin route guards. The dry
// announcement route requires no storage, signing or external network calls.
const bundled = buildSync({
  stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: `
      import api from './apps/api/src/index.ts';
      import { boundedJson, BodyTooLarge } from './apps/web/src/lib/bounded-body.ts';
      export * from './apps/api/src/index.ts';
      export default {
        async fetch(req, env, ctx) {
          if (new URL(req.url).pathname !== '/test-body') return api.fetch(req, env, ctx);
          try { return Response.json(await boundedJson(req, 64)); }
          catch (error) { return new Response(null, {status:error instanceof BodyTooLarge ? 413 : 400}); }
        }
      };
    `,
  },
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
  external: ["cloudflare:workers"],
});
const options = {
  modules: true, script: bundled.outputFiles[0].text,
  compatibilityDate: "2025-01-01", compatibilityFlags: ["nodejs_compat"],
  bindings: { ADMIN_TOKEN: "runtime-test-secret" },
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
beforeAll(async () => { await mf.ready; });
afterAll(async () => { await mf.dispose(); });

describe("admin checks in the deployed-compatible Workers runtime", () => {
  it("accepts the exact token on the real dry-run route", async () => {
    const res = await mf.dispatchFetch("https://api.xcp.fun/admin/announce-test?dry=1", {
      method: "POST", headers: { "x-admin-token": "runtime-test-secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("would_send");
  });
  it.each([undefined, "", "runtime-test-secrex", "runtime-test-secret-extra"])("rejects invalid credentials: %s", async token => {
    const res = await mf.dispatchFetch("https://api.xcp.fun/admin/announce-test?dry=1", {
      method: "POST", headers: token === undefined ? {} : { "x-admin-token": token },
    });
    expect(res.status).toBe(401);
  });
  it("enforces actual streamed body bytes in workerd", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(" ".repeat(32))); c.enqueue(encoder.encode(" ".repeat(33))); c.close(); },
    });
    const rejected = await mf.dispatchFetch("https://api.xcp.fun/test-body", {method:"POST", body, duplex:"half"});
    expect(rejected.status).toBe(413);
    const accepted = await mf.dispatchFetch("https://api.xcp.fun/test-body", {method:"POST", body:JSON.stringify({message:"😊"})});
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({message:"😊"});
  });
});
