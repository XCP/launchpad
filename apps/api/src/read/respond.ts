/**
 * Response plumbing shared by every read route: the router factory, the edge
 * cache in front of it, and the JSON envelope helper. No SQL lives here —
 * queries own their SQL in src/queries/<domain>.ts.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "#api/env";

export type ReadApp = Hono<{ Bindings: Env }>;
export type Ctx = Context<{ Bindings: Env }>;

/**
 * Serve read routes from the colo's cache before running the handler.
 *
 * Every route here already sets `cache-control`, and that header was doing
 * half the job it looked like it was doing: a Worker on a custom domain runs
 * BEFORE the zone cache, so `public, max-age=60` was a browser-only
 * instruction. Responses never carried a cf-cache-status header at all,
 * because they never entered Cloudflare's cache. Every distinct visitor's
 * first call — and every call after their own browser cache lapsed — ran the
 * handler and queried D1.
 *
 * That is invisible at a hundred visitors a day and is exactly the wrong shape
 * for a launch. The site-wide index poll runs per open tab, so a thousand tabs
 * is a thousand independent handler invocations asking one database the same
 * question. With this, they collapse to roughly one origin request per colo
 * per TTL: the handler does not run on a hit, D1 is not touched, and a distant
 * visitor is answered locally instead of across an ocean.
 *
 * The cache is per-colo, not global — N warm caches rather than one — which is
 * the right trade here. Warming is proportional to how many places the traffic
 * comes from, not to how much of it there is.
 */
const edgeCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // Only GETs, and only the ones the Cache API will actually key on. Nothing
  // in this router mutates, so this is a guard against a future route rather
  // than a case that exists today.
  if (c.req.method !== "GET") return next();

  const cache = caches.default;
  const hit = await cache.match(c.req.raw);
  if (hit) return hit;

  await next();

  // Errors are never cached: a 400 from a bad `resolution` and a 500 from a
  // transient D1 blip would both otherwise stick for the TTL, turning one bad
  // moment into a minute of them.
  const res = c.res;
  if (!res.ok) return;

  // Store only what asked to be stored. A route that omits cache-control is
  // saying it wants to be fresh, and this must not overrule that by inventing
  // a TTL on its behalf.
  const control = res.headers.get("cache-control");
  if (!control || !/max-age=\d+/.test(control)) return;

  // clone() because a body can only be read once, and the caller still needs
  // it. waitUntil so filling the cache never delays the response that filled
  // it.
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
};

export const router = (): ReadApp => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", edgeCache);
  return app;
};

/** Envelope: { result, result_count? }. Cached at the edge by the middleware
 *  above, and in the browser by this header. */
export const J = (c: Ctx, body: unknown, ttl = 30) =>
  c.json(body, 200, {
    "cache-control": `public, max-age=${ttl}, stale-while-revalidate=${ttl}`,
    "access-control-allow-origin": "*",
  });
