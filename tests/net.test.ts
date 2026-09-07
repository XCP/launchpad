import { describe, expect, it, vi } from "vitest";
import { discard, mapWithLimit } from "@/lib/net";

/**
 * These two helpers exist because of a production failure: the worker held
 * response bodies open on error paths and fanned out without a ceiling, hit
 * Cloudflare's six-connection limit, and the runtime cancelled other requests'
 * responses to avoid deadlock. The tests pin the two properties that failure
 * depended on — that an abandoned body is closed, and that a fan-out never
 * exceeds its ceiling.
 */

/** A Response-shaped object whose body records whether it was cancelled. */
function bodied() {
  const cancel = vi.fn().mockResolvedValue(undefined);
  return { response: { body: { cancel } } as unknown as Response, cancel };
}

describe("discard", () => {
  it("cancels the body of a response we are abandoning", async () => {
    const { response, cancel } = bodied();
    await discard(response);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("tolerates a response with no body, and null or undefined", async () => {
    await expect(discard(new Response(null))).resolves.toBeUndefined();
    await expect(discard(null)).resolves.toBeUndefined();
    await expect(discard(undefined)).resolves.toBeUndefined();
  });

  it("never throws, because it runs on a path that already failed", async () => {
    const exploding = {
      body: { cancel: () => Promise.reject(new Error("already disturbed")) },
    } as unknown as Response;
    await expect(discard(exploding)).resolves.toBeUndefined();
  });

  it("does not throw when the body was already consumed", async () => {
    const response = new Response("read me");
    await response.text();
    await expect(discard(response)).resolves.toBeUndefined();
  });
});

describe("mapWithLimit", () => {
  it("returns results in input order, not completion order", async () => {
    const delays = [30, 0, 20, 10];
    const out = await mapWithLimit(delays, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:0", "2:20", "3:10"]);
  });

  it("never runs more than the ceiling at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);

    await mapWithLimit(
      items,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return n;
      },
      5,
    );

    expect(peak).toBe(5);
  });

  it("defaults to a ceiling below the platform's six connections", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithLimit(Array.from({ length: 20 }, (_, i) => i), async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBe(4);
  });

  it("does not start more workers than there are items", async () => {
    let starts = 0;
    await mapWithLimit(
      [1, 2],
      async (n) => {
        starts += 1;
        return n;
      },
      10,
    );
    expect(starts).toBe(2);
  });

  it("handles an empty list without calling the mapper", async () => {
    const fn = vi.fn();
    await expect(mapWithLimit([], fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("treats a zero or negative ceiling as one at a time rather than none", async () => {
    let peak = 0;
    let inFlight = 0;
    const out = await mapWithLimit(
      [1, 2, 3],
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return n * 2;
      },
      0,
    );
    expect(peak).toBe(1);
    expect(out).toEqual([2, 4, 6]);
  });

  it("propagates a rejection, as Promise.all would", async () => {
    await expect(
      mapWithLimit([1, 2, 3], async (n) => {
        if (n === 2) throw new Error("element two");
        return n;
      }),
    ).rejects.toThrow("element two");
  });

  it("a slow element delays only itself, not the elements behind it", async () => {
    // The point of pulling from a shared cursor rather than slicing into
    // fixed chunks: one straggler must not hold up a whole chunk.
    const order: number[] = [];
    await mapWithLimit(
      [50, 1, 1, 1],
      async (ms, i) => {
        await new Promise((r) => setTimeout(r, ms));
        order.push(i);
        return i;
      },
      2,
    );
    expect(order[order.length - 1]).toBe(0);
  });
});
