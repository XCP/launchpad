/**
 * Whether a blocked Bitcoin host is survivable.
 *
 * This is the gate on the whole buy flow: nothing in the router runs until
 * the UTXO read answers, so every way this file can be wrong ends with a user
 * who cannot buy and a message that does not tell them why. The two cases
 * that produced real reports are both here — a host that never responds, and
 * a host that responds with a refusal — and the second is the one a
 * reasonable implementation gets wrong, because refusing looks like answering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MEMPOOL = "https://mempool.space/api";
const BLOCKSTREAM = "https://blockstream.info/api";

/** A fetch that answers per host, and records the order it was asked in. */
function fetchStub(
  answers: Record<string, () => Promise<Response> | Response>,
): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string | URL) => {
    const href = String(url);
    calls.push(href);
    const key = Object.keys(answers).find((base) => href.startsWith(base));
    if (!key) throw new TypeError("Failed to fetch");
    return answers[key]!();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** The browser's own error when a request never reaches a server at all —
 *  what a DNS block, a filter list, or the Great Firewall actually produces. */
const unreachable = () => {
  throw new TypeError("Failed to fetch");
};

const UTXOS = [
  { txid: "a".repeat(64), vout: 0, value: 50_000, status: { confirmed: true } },
];

/** Fresh module state per test: the host pin is module-level on purpose, so a
 *  shared instance would let one test's pin decide the next test's order. */
async function load() {
  vi.resetModules();
  return import("@/lib/esplora");
}

beforeEach(() => {
  // No localStorage in the node environment these tests run in, which is also
  // the private-browsing case the module has to survive.
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a host that cannot be reached", () => {
  it("falls through to the next one and returns its answer", async () => {
    const { fn, calls } = fetchStub({
      [MEMPOOL]: unreachable,
      [BLOCKSTREAM]: () => json(UTXOS),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    expect(await fetchAddressUtxos("bc1qexample")).toEqual(UTXOS);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("mempool.space");
    expect(calls[1]).toContain("blockstream.info");
  });

  it("names both hosts when neither answers, and leads with rate limiting", async () => {
    // The message a user reads. "Failed to fetch" was the old one and told
    // them nothing they could act on. Rate limiting comes first because it is
    // both the most common cause and the only one they can fix by waiting —
    // and because a browser cannot tell it apart from a block, the message has
    // to carry both without pretending to know which.
    const { fn } = fetchStub({ [MEMPOOL]: unreachable, [BLOCKSTREAM]: unreachable });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    const message = await fetchAddressUtxos("bc1qexample").catch((e: Error) => e.message);
    expect(message).toContain("mempool.space and blockstream.info");
    expect(message).toContain("wait a minute");
    expect(message).toContain("ad blocker");
  });
});

describe("a host that answers and refuses", () => {
  it("asks the next host anyway", async () => {
    // mempool.space returns 400 for an address holding more than 500 UTXOs
    // ("Contact support to raise limits"). blockstream serves it. Stopping at
    // a 4xx because it is "a real answer" is what left that wallet unable to
    // buy at all.
    const { fn, calls } = fetchStub({
      [MEMPOOL]: () => new Response("Too many unspent transaction outputs (>500).", { status: 400 }),
      [BLOCKSTREAM]: () => json(UTXOS),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    expect(await fetchAddressUtxos("bc1qbusy")).toEqual(UTXOS);
    expect(calls).toHaveLength(2);
  });

  it("reports the refusal rather than the network when a host did respond", async () => {
    // Both refusing is a different problem from both being gone, and telling
    // someone to check their ad blocker when the hosts are simply unhappy
    // sends them to fix something that is not broken.
    const { fn } = fetchStub({
      [MEMPOOL]: () => new Response("nope", { status: 400 }),
      [BLOCKSTREAM]: () => new Response("nope", { status: 400 }),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    const err = await fetchAddressUtxos("notanaddress").catch((e: Error) => e);
    expect((err as Error).message).toContain("HTTP 400");
    expect((err as Error).message).not.toContain("ad blocker");
  });

  it("treats a body that is not JSON as a failure, not as no UTXOs", async () => {
    // An HTML error page served with a 200 is what a captive portal or an
    // interception proxy hands back. Parsing it to nothing and calling that an
    // empty wallet would report "Not enough BTC" to someone who has plenty.
    const { fn } = fetchStub({
      [MEMPOOL]: () => new Response("<html>blocked</html>", { status: 200 }),
      [BLOCKSTREAM]: () => json(UTXOS),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    expect(await fetchAddressUtxos("bc1qexample")).toEqual(UTXOS);
  });
});

describe("remembering which host works", () => {
  it("asks the host that answered first next time", async () => {
    // Learning that a host is blocked costs a timeout. Paying it on every
    // call is what would make the page feel broken for the blocked user.
    const { fn, calls } = fetchStub({
      [MEMPOOL]: unreachable,
      [BLOCKSTREAM]: () => json(UTXOS),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    await fetchAddressUtxos("bc1qexample");
    calls.length = 0;
    await fetchAddressUtxos("bc1qexample");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("blockstream.info");
  });

  it("still falls back the other way once pinned", async () => {
    // The pin is a preference, not a commitment: whichever host is second
    // must still be tried when the pinned one stops answering.
    let mempoolUp = false;
    const { fn, calls } = fetchStub({
      [MEMPOOL]: () => (mempoolUp ? json(UTXOS) : unreachable()),
      [BLOCKSTREAM]: () => json(UTXOS),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchAddressUtxos } = await load();

    await fetchAddressUtxos("bc1qexample"); // pins blockstream
    mempoolUp = true;
    calls.length = 0;

    // Now blockstream goes away.
    const flipped = fetchStub({ [MEMPOOL]: () => json(UTXOS), [BLOCKSTREAM]: unreachable });
    vi.stubGlobal("fetch", flipped.fn);
    expect(await fetchAddressUtxos("bc1qexample")).toEqual(UTXOS);
    expect(flipped.calls[0]).toContain("blockstream.info");
    expect(flipped.calls[1]).toContain("mempool.space");
  });
});

describe("fee estimates, which the hosts do not agree on", () => {
  it("reads mempool.space's own shape", async () => {
    const { fn } = fetchStub({ [MEMPOOL]: () => json({ halfHourFee: 0.644 }) });
    vi.stubGlobal("fetch", fn);
    const { fetchHalfHourFeeRate } = await load();
    expect(await fetchHalfHourFeeRate()).toBe(0.644);
  });

  it("reads the 3-block target out of Esplora's map", async () => {
    // blockstream publishes /fee-estimates as target-in-blocks -> sat/vB.
    // Three blocks is the half hour mempool.space names outright.
    const { fn } = fetchStub({
      [MEMPOOL]: unreachable,
      [BLOCKSTREAM]: () => json({ "1": 3.2, "2": 2.004, "3": 1.51, "6": 0.461 }),
    });
    vi.stubGlobal("fetch", fn);
    const { fetchHalfHourFeeRate } = await load();
    expect(await fetchHalfHourFeeRate()).toBe(1.51);
  });

  it("says null rather than inventing a rate", async () => {
    // The caller has its own floor. A made-up estimate would be multiplied
    // into a displayed price and read as measured.
    const { fn } = fetchStub({ [MEMPOOL]: () => json({ halfHourFee: 0 }) });
    vi.stubGlobal("fetch", fn);
    const { fetchHalfHourFeeRate } = await load();
    expect(await fetchHalfHourFeeRate()).toBeNull();
  });
});
