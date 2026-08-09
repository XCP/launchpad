/**
 * Response plumbing shared by every read route: the router factory and the
 * JSON envelope helper. No SQL lives here — queries own their SQL in
 * src/queries/<domain>.ts.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "#api/env";

export type ReadApp = Hono<{ Bindings: Env }>;
export type Ctx = Context<{ Bindings: Env }>;
export const router = (): ReadApp => new Hono<{ Bindings: Env }>();

/** Envelope: { result, result_count? }. Cached at the edge via cache-control. */
export const J = (c: Ctx, body: unknown, ttl = 30) =>
  c.json(body, 200, {
    "cache-control": `public, max-age=${ttl}, stale-while-revalidate=${ttl}`,
    "access-control-allow-origin": "*",
  });
