import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const pool = { asset_a: "TOKEN", asset_b: "XCP", reserve_a: "99999999999999999", reserve_b: 123 };

it("exhausts pool pages before establishing absence and preserves raw reserves", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ result: [{ ...pool, asset_a: "OTHER", asset_b: "BTC" }], next_cursor: 0 }))
    .mockResolvedValueOnce(Response.json({ result: [pool], next_cursor: null }));
  vi.stubGlobal("fetch", fetch);
  const { fetchRecoveryPools } = await import("#api/integrations/counterparty");
  const result = await fetchRecoveryPools();
  expect(result).toEqual({ known: true, pools: new Map([["TOKEN", pool]]) });
  expect(new URL(fetch.mock.calls[1]![0]).searchParams.get("cursor")).toBe("0");
});

it.each(["failed-page", "repeated-cursor", "missing-cursor", "malformed-page"])(
  "never treats an incomplete snapshot (%s) as pool absence", async failure => {
    const second = failure === "failed-page" ? new Response(null, { status: 503 })
      : failure === "repeated-cursor" ? Response.json({ result: [], next_cursor: 4 })
        : failure === "missing-cursor" ? Response.json({ result: [] })
          : Response.json({ result: [{}], next_cursor: null });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ result: [pool], next_cursor: 4 }))
      .mockResolvedValueOnce(second);
    vi.stubGlobal("fetch", fetch);
    const { fetchRecoveryPools } = await import("#api/integrations/counterparty");
    expect(await fetchRecoveryPools()).toEqual({ known: false, deferred: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
