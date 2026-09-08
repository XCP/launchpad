import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

process.env.NODE_ENV = "production";
const { default: React } = await import("react");
const { renderToReadableStream } = await import("next/dist/compiled/react-server-dom-webpack/server.node.js");
const { createDedupeFetch } = await import("next/dist/server/lib/dedupe-fetch.js");
const root = fileURLToPath(new URL("..", import.meta.url));
const web = path.join(root, "apps/web");
const require = createRequire(import.meta.url);
const baselineRef = process.argv.find((arg) => arg.startsWith("--baseline-ref="))?.slice("--baseline-ref=".length);
const expectedAssetReads = Number(process.argv.find((arg) => arg.startsWith("--expected-asset-reads="))?.split("=")[1] ?? 1);
const expectedHomeReads = Number(process.argv.find((arg) => arg.startsWith("--expected-home-reads="))?.split("=")[1] ?? 1);

// These are the actual page and metadata functions rendered through Next's
// production React Flight renderer, using its request-scoped fetch deduper.
// Only the service-binding context, locale context, and final client views are
// fixtures. Price calculation, API reads, parsing and page orchestration run.
async function loadPage(name, relativePath) {
  const output = path.join(root, ".test-dist/render-reads", `${name}.mjs`);
  await mkdir(path.dirname(output), { recursive: true });
  await build({
    entryPoints: [path.join(root, relativePath)], outfile: output,
    bundle: true, platform: "node", format: "esm", packages: "external",
    external: ["react", "react/jsx-runtime"], tsconfig: path.join(web, "tsconfig.json"),
    plugins: [{ name: "render-boundaries", setup(builder) {
      if (baselineRef) builder.onLoad({ filter: /[\\/]app[\\/]\[lang\][\\/](?:\[asset\][\\/])?page\.tsx$/ }, ({ path: filename }) => ({
        contents: execFileSync("git", ["show", `${baselineRef}:${path.relative(root, filename).replaceAll("\\", "/")}`], { cwd: root, encoding: "utf8" }),
        loader: "tsx", resolveDir: path.dirname(filename),
      }));
      builder.onResolve({ filter: /^@launchpad\/xcp69\// }, ({ path: name }) => ({ path: require.resolve(name) }));
      builder.onResolve({ filter: /^(@opennextjs\/cloudflare|next\/navigation|@\/lib\/i18n\/server|@\/components\/lazy-link)$/ }, ({ path: name }) => ({ path: name, namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/app\/\[lang\]\/(?:\[asset\]\/)?_components\/(launch-view|home-toolbar|launch-sections)$/ }, ({ path: name }) => ({ path: name, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => {
        if (name === "@opennextjs/cloudflare") return { contents: "export const getCloudflareContext = async () => globalThis.__renderReadFixture.context;", loader: "js" };
        if (name === "next/navigation") return { contents: "export function notFound() { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404'); }", loader: "js" };
        if (name === "@/lib/i18n/server") return { contents: "export const getMessages = async () => ({}); export const getT = async () => (message) => message;", loader: "js" };
        const exportName = name.endsWith("launch-view") ? "LaunchView" : name.endsWith("home-toolbar") ? "HomeToolbar" : name.endsWith("launch-sections") ? "LaunchSections" : "LazyLink";
        return { contents: `import React from 'react'; export function ${exportName}(props) { return React.createElement('div', {'data-view': '${exportName}', 'data-xcp': props.xcpUsd, 'data-btc': props.btcUsd, 'data-day-ago': props.xcpUsdDayAgo, 'data-btc-change': props.btcChange30d, 'data-xcp-change': props.xcpChange30d, 'data-phase': props.phase}, props.children); }`, loader: "js" };
      });
    } }],
  });
  return import(pathToFileURL(output).href);
}
const assetPage = await loadPage("asset", "apps/web/src/app/[lang]/[asset]/page.tsx");
const homePage = await loadPage("home", "apps/web/src/app/[lang]/page.tsx");
const originalFetch = globalThis.fetch;

const fairminter = {
  tx_hash: "aa".repeat(32), tx_index: 1, block_index: 899964,
  source: "1SomeCreatorAddress", asset: "TESTCOIN", asset_longname: null,
  description: "A launch description", price: "1000000", quantity_by_price: "100000000000",
  hard_cap: "10000000000000000", soft_cap: "6900000000000000", pool_quantity: "3100000000000000",
  start_block: 900000, end_block: 0, soft_cap_deadline_block: 901000,
  burn_payment: false, max_mint_per_tx: "100000000000000", max_mint_per_address: "100000000000000",
  premint_quantity: "0", minted_asset_commission_int: "0", lock_description: true, lock_quantity: true,
  divisible: true, lp_asset: "A69000000000000069", status: "pending", earned_quantity: null, paid_quantity: null,
};

function setup({ mode = "ok", xcp = 2, btc = 80000, dispenser = false } = {}) {
  const current = { tickerReads: 0, bindingReads: 0, unexpected: [], cancelled: 0 };
  globalThis.__renderReadFixture = { context: { cf: {}, env: { LAUNCHPAD_API: { async fetch(request) {
    const url = new URL(request.url);
    current.bindingReads++;
    if (url.pathname === "/v2/launches") return Response.json({ result: [], total: 0 });
    if (url.pathname === "/v2/launches/TESTCOIN") return Response.json({ result: null });
    current.unexpected.push(url.href);
    return new Response(null, { status: 404 });
  } } } } };
  globalThis.fetch = createDedupeFetch(async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "api.xcp.io" && url.pathname === "/v2/price") {
      current.tickerReads++;
      if (mode === "throw") throw new Error("ticker unavailable");
      if (mode === "malformed") return new Response("not json");
      if (mode === "503") return new Response(new ReadableStream({ cancel() { current.cancelled++; } }), { status: 503 });
      return Response.json({ result: { xcp: { usd: xcp, day: "2026-09-08" }, btc: { usd: btc }, history: [
        { day: "2026-08-09", usd: 1, btc: 40000 }, { day: "2026-09-07", usd: 1.5, btc: 70000 },
      ] } });
    }
    if (url.hostname === "api.counterparty.io") {
      if (url.pathname === "/v2/") return Response.json({ result: { counterparty_height: 899970 } });
      if (url.pathname === "/v2/assets/TESTCOIN/fairminters") return Response.json({ result: [fairminter] });
      if (url.pathname === "/v2/assets/TESTCOIN/issuances") return Response.json({ result_count: 1, result: [{
        asset: fairminter.asset, tx_hash: fairminter.tx_hash, tx_index: fairminter.tx_index,
        msg_index: 0, block_index: fairminter.block_index, block_time: 1749798000,
        asset_events: "open_fairminter", status: "valid",
      }] });
      if (url.pathname === "/v2/assets/XCP/dispensers") return Response.json({ result: dispenser ? [{ tx_hash: "dispense", give_remaining: 100000000, give_quantity: 100000000, satoshirate: 1000 }] : [] });
      if (url.pathname === "/v2/mempool/events/DISPENSE") return Response.json({ result: [] });
    }
    current.unexpected.push(url.href);
    return new Response(null, { status: 404 });
  });
  return current;
}

async function render(module) {
  const params = Promise.resolve({ lang: "en", asset: "TESTCOIN" });
  async function Metadata() {
    const metadata = await module.generateMetadata({ params });
    return React.createElement("meta", { name: "description", content: metadata.description });
  }
  const errors = [];
  const stream = renderToReadableStream(React.createElement(React.Fragment, null,
    React.createElement(Metadata), React.createElement(module.default, { params })), {}, {
    onError(error) { errors.push(error); },
  });
  const flight = await new Response(stream).text();
  assert.deepEqual(errors, [], "actual page and metadata render succeeds");
  return flight;
}

try {
  for (const [name, module, expectedReads] of [["asset", assetPage, expectedAssetReads], ["home", homePage, expectedHomeReads]]) {
    await test(`${name} renders identical prices from one ticker read`, async () => {
      const current = setup();
      const flight = await render(module);
      assert.equal(current.tickerReads, expectedReads);
      assert.deepEqual(current.unexpected, []);
      assert.match(flight, /"data-xcp":2/);
      assert.match(flight, /"data-btc":80000/);
      if (name === "asset") assert.equal(current.bindingReads, 1, "existing indexed-launch memoization remains intact");
      if (name === "home") {
        assert.match(flight, /"data-day-ago":1.5/);
        assert.match(flight, /"data-btc-change":100/);
        assert.match(flight, /"data-xcp-change":100/);
      }
    });
    await test(`${name} sees new prices on the next RSC request`, async () => {
      setup();
      await render(module);
      const current = setup({ xcp: 4, btc: 90000 });
      const flight = await render(module);
      assert.match(flight, /"data-xcp":4/);
      assert.match(flight, /"data-btc":90000/);
      assert.equal(current.tickerReads, expectedReads);
    });
    await test(`${name} preserves the actionable dispenser price`, async () => {
      const current = setup({ dispenser: true });
      const flight = await render(module);
      assert.match(flight, /"data-xcp":0.8/);
      assert.match(flight, /"data-btc":80000/);
      assert.equal(current.tickerReads, expectedReads);
    });
    for (const mode of ["503", "throw", "malformed"]) {
      await test(`${name} ${mode} ticker keeps null-price fallback and recovers next request`, async () => {
        const current = setup({ mode });
        const flight = await render(module);
        assert.match(flight, /"data-xcp":null/);
        assert.match(flight, /"data-btc":null/);
        assert.equal(current.tickerReads, expectedReads);
        if (mode === "503") assert.equal(current.cancelled, expectedReads);
        setup({ xcp: 7 });
        assert.match(await render(module), /"data-xcp":7/);
      });
    }
  }
  console.log(JSON.stringify({ assetTickerReads: expectedAssetReads, homeTickerReads: expectedHomeReads, subsequentRequestFresh: true, nullAndFailureRecovery: true }));
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__renderReadFixture;
}
